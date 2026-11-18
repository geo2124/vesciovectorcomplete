import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth";
import { useDB, useTenantUser } from "@/lib/data-store";
import {
  BookOpen,
  Compass,
  Download,
  CheckCircle2,
  HelpCircle,
  Shield,
  Users,
  Calendar,
  DollarSign,
  Layers,
  Activity,
  FileText,
  QrCode,
  PenTool,
  ArrowRight,
  Search,
  Sparkles,
  Filter,
  ExternalLink,
  Lock,
  Printer,
  ChevronDown,
  ChevronUp,
  Info,
  Building,
  ShoppingBag,
  UserCheck,
  Smartphone,
  Sliders,
  Database,
  WifiOff,
  Flame,
  Award,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/documentation")({
  head: () => ({
    meta: [
      { title: "Documentation & Software Tour — Vescio Vector" },
      {
        name: "description",
        content:
          "Comprehensive software guide, interactive tour, and downloadable manuals tailored to your academy role.",
      },
      { property: "og:title", content: "Documentation & Software Tour — Vescio Vector" },
      {
        property: "og:description",
        content:
          "Full feature tour, role-based service explanations, and downloadable operations manual.",
      },
    ],
  }),
  component: DocumentationPage,
});

interface ServiceModule {
  id: string;
  title: string;
  route: string;
  category: "operations" | "technical" | "financial" | "admin";
  targetRoles: string[];
  summary: string;
  icon: LucideIcon;
  capabilities: string[];
  workflows: { name: string; steps: string[] }[];
  accessNotes: string;
  offlineSupport: string;
}

const ALL_MODULES: ServiceModule[] = [
  {
    id: "dashboard",
    title: "Executive Cockpit & Live Operations",
    route: "/",
    category: "operations",
    targetRoles: ["Super Admin", "Academy Manager", "Branch Manager"],
    summary:
      "Central command hub delivering instant operational visibility: active enrollment count, monthly cashflow, court utilization rate, and today's session timeline.",
    icon: Activity,
    capabilities: [
      "Real-time attendance ratio and practice session counters",
      "Live tuition collection progress vs projected monthly revenue",
      "Player roster capacity gauge with hard cap warnings",
      "Quick-action launcher for rapid player registration and emergency logs",
    ],
    workflows: [
      {
        name: "Daily Operations Review",
        steps: [
          "Check the today's sessions counter to anticipate court and coach load.",
          "Verify player capacity against the academy's plan ceiling.",
          "Review the financial quick-summary for overdue tuition balances.",
        ],
      },
    ],
    accessNotes:
      "Super Admins and Academy Managers see complete academy-wide metrics. Branch Managers view metrics scoped strictly to their assigned facility.",
    offlineSupport:
      "Full IndexedDB snapshot available offline. Cached KPIs render in 0ms on startup.",
  },
  {
    id: "calendar",
    title: "Dynamic Academy Calendar & Bookings",
    route: "/calendar",
    category: "operations",
    targetRoles: ["Super Admin", "Academy Manager", "Branch Manager", "Coach"],
    summary:
      "Multi-perspective schedule matrix (Month, Week, Day) with multi-criteria filtering by branch, head coach, age-bracket team, and session type.",
    icon: Calendar,
    capabilities: [
      "Month, Week, and Day timeline representations",
      "Color-coded taxonomy for Practices, Competitive Games, Camps, and Seminars",
      "Instant conflict detection across court allocations and assigned coaches",
      "Detailed session modal with one-click navigation to attendance rosters",
    ],
    workflows: [
      {
        name: "Booking a Court Slot",
        steps: [
          "Switch to Week or Day view and select the target branch and court.",
          "Click an empty time block or choose 'Schedule Session' in the toolbar.",
          "Assign the age division team, head coach, and drill curriculum link.",
          "Save changes — events sync to all staff calendars in real time.",
        ],
      },
    ],
    accessNotes:
      "All staff can view the calendar. Super Admins, Academy Managers, and Branch Managers hold schedule authoring rights.",
    offlineSupport:
      "Calendar events are stored in offline IndexedDB cache and sync upon network reconnection.",
  },
  {
    id: "sessions",
    title: "Training Sessions & QR Attendance",
    route: "/sessions",
    category: "operations",
    targetRoles: ["Super Admin", "Academy Manager", "Branch Manager", "Head Coach", "Coach"],
    summary:
      "High-throughput session execution workflow with contactless camera-based QR badge scanning, custom drill linkage, and completion sign-offs.",
    icon: QrCode,
    capabilities: [
      "Contactless camera and optical QR scanner for instant player badge check-in",
      "Multi-status attendance tracking: Present, Absent, Excused, and Late with timestamps",
      "Direct linkage to Tactical Board practice plans and drill sequences",
      "Coach session sign-off generating verified attendance records for payroll",
    ],
    workflows: [
      {
        name: "Running an On-Court Check-In",
        steps: [
          "Open the current active session from the timeline.",
          "Click 'Launch QR Scanner' to activate the device webcam or rear smartphone camera.",
          "Hold the player's physical pass card or digital phone badge to the camera.",
          "The system emits a confirmation tone, marks attendance, and displays medical alerts.",
        ],
      },
    ],
    accessNotes:
      "Coaches hold full check-in authority for their assigned sessions. Managers oversee all sessions.",
    offlineSupport:
      "Optimistic UI updates ensure check-ins register immediately even in courts with zero cellular signal.",
  },
  {
    id: "players",
    title: "Players Registry & Medical Health",
    route: "/players",
    category: "operations",
    targetRoles: ["Super Admin", "Academy Manager", "Branch Manager", "Head Coach"],
    summary:
      "Comprehensive player biometric and administrative registry, featuring prominent emergency health badges, primary/secondary guardian contacts, and pass cards.",
    icon: Users,
    capabilities: [
      "Prominent high-visibility Medical Alert tags for allergies, asthma, and chronic injuries",
      "Primary and secondary guardian emergency dossiers with one-tap WhatsApp chat",
      "Digital Player Pass card generator with high-density cryptographic QR codes",
      "Automated tuition status indicators with soft overdue flags and inactive suspension badges",
    ],
    workflows: [
      {
        name: "Generating a Player Pass Card",
        steps: [
          "Locate the player in the directory table and click their row.",
          "Click the 'Pass Card' button in the player action toolbar.",
          "Preview the card with the player photo, jersey number, and QR code.",
          "Click 'Print Pass' or 'Download PDF' for tournament badge issuance.",
        ],
      },
      {
        name: "Handling Medical Alerts",
        steps: [
          "Players with recorded medical notes display an amber warning badge beside their name.",
          "Clicking the badge opens the critical health dossier with guardian emergency instructions.",
        ],
      },
    ],
    accessNotes:
      "Medical and guardian contacts are accessible to authorized staff. Coaches view medical alerts on their court roster.",
    offlineSupport:
      "Player profiles are cached locally for rapid emergency access without internet.",
  },
  {
    id: "technical",
    title: "Technical Directorate & Tactical Board",
    route: "/technical",
    category: "technical",
    targetRoles: ["Technical Director", "Super Admin", "Head Coach"],
    summary:
      "Elite tactical coaching suite with interactive basketball court drawing board, diagrammatic playbooks, searchable drill repository, and timed plan authoring.",
    icon: PenTool,
    capabilities: [
      "Interactive Drawing Board supporting Full Court and Half Court vector layouts",
      "Offensive players (X), Defensive players (O), ball paths, screens, and movement vectors",
      "One-click high-resolution PNG and PDF diagram export for playbook distribution",
      "Structured Practice Plan Editor with timed blocks: Warmup, Fundamentals, Scrimmage, Cooldown",
      "Curriculum repository categorized by age division and training phase",
    ],
    workflows: [
      {
        name: "Designing a Tactical Drill",
        steps: [
          "Navigate to Technical Portal > Drawing Board tab.",
          "Select Half Court or Full Court background mode.",
          "Place player tokens, draw passing lines, dribble paths, and screen icons.",
          "Click 'Save Drill' to store in the academy curriculum library.",
        ],
      },
      {
        name: "Building a 90-Minute Practice Plan",
        steps: [
          "Open Plan Editor and select target team and date.",
          "Add structured drills from the library with designated time durations.",
          "Attach the plan to the scheduled session — coaches see it instantly on their phones.",
        ],
      },
    ],
    accessNotes:
      "Technical Directors hold full administrative authority over tactical drills and curricula.",
    offlineSupport:
      "Drawing board operates client-side with instant local export even when offline.",
  },
  {
    id: "coach",
    title: "Coach Field Portal (Mobile First)",
    route: "/coach",
    category: "technical",
    targetRoles: ["Coach", "Head Coach", "Super Admin"],
    summary:
      "Streamlined, distraction-free smartphone experience designed for coaches standing on the court: assigned sessions, one-tap check-in, drill cards, and statement audits.",
    icon: Smartphone,
    capabilities: [
      "Clean mobile-first viewport with high-contrast on-court visibility",
      "Immediate view of today's assigned training blocks and court locations",
      "Rapid one-tap attendance toggles with medical condition warnings",
      "Tactical drill reference cards with diagrams and coaching cues",
      "Coach verified session statement audit for monthly payroll transparency",
    ],
    workflows: [
      {
        name: "Court Attendance & Completion",
        steps: [
          "Open Vescio Vector on your phone — Coach Portal loads automatically.",
          "Tap the active practice session to expand the roster checklist.",
          "Tap player names to cycle between Present and Absent.",
          "Tap 'Complete Session' to submit verified session completion to administration.",
        ],
      },
    ],
    accessNotes: "Coaches are automatically routed directly to this portal upon authentication.",
    offlineSupport:
      "Works seamlessly offline. Rosters and drill cards remain accessible without a data connection.",
  },
  {
    id: "branches",
    title: "Multi-Branch Management & Shift Builder",
    route: "/branches",
    category: "operations",
    targetRoles: ["Super Admin", "Academy Manager", "Branch Manager"],
    summary:
      "Multi-facility orchestration governing court inventories, surface materials, assigned branch managers, schedule shift matrices, and local fiscal dossiers.",
    icon: Building,
    capabilities: [
      "Court inventory tracking: surface types (Hardwood, Synthetic, Outdoor), lighting, and hoops",
      "Interactive Branch Schedule Builder supporting day-of-week slots, time shifts, and limits",
      "Dedicated branch expense tracking linked to the academy accounting ledger",
      "Exportable Branch Dossier PDF summarizing courts, teams, players, and financials",
    ],
    workflows: [
      {
        name: "Configuring a Weekly Court Schedule",
        steps: [
          "Open the target branch and expand the Schedule Builder section.",
          "Select the days of the week when training occurs (e.g., Monday, Wednesday, Friday).",
          "Configure court shifts, designated age brackets, and capacity allocations.",
          "Save the template to populate recurring session generators automatically.",
        ],
      },
    ],
    accessNotes:
      "Super Admins manage all branches. Branch Managers manage their assigned facility only.",
    offlineSupport: "Branch parameters and court maps are stored in local cache.",
  },
  {
    id: "merchandise",
    title: "Merchandise Catalog & POS Terminal",
    route: "/merchandise",
    category: "financial",
    targetRoles: ["Super Admin", "Academy Manager", "Branch Manager", "Accountant"],
    summary:
      "Retail inventory and point-of-sale suite managing academy uniforms, warmup gear, basketballs, accessories, stock reorders, and instant order settlement.",
    icon: ShoppingBag,
    capabilities: [
      "Complete inventory catalog with SKU, sizing, unit cost, and retail price",
      "Stock level monitoring with automated low-stock warnings and reorder thresholds",
      "Instant POS checkout with cash, card, or tuition ledger balance debit",
      "Digital receipt and printable packing slip PDF generation",
    ],
    workflows: [
      {
        name: "Processing a Jersey Order",
        steps: [
          "Select the uniform item and desired size in the merchandise catalog.",
          "Select the purchasing player or parent.",
          "Choose payment method: Direct Cash/Card or Add to Monthly Tuition Ledger.",
          "Click 'Confirm Order' — inventory updates atomically and a receipt PDF is ready.",
        ],
      },
    ],
    accessNotes:
      "Managers and accountants can create and settle orders. Staff can check stock levels.",
    offlineSupport: "Optimistic inventory checkout with automatic rollback if a sync error occurs.",
  },
  {
    id: "accounting",
    title: "Financial Ledger & Automated Invoicing",
    route: "/accounting",
    category: "financial",
    targetRoles: ["Super Admin", "Academy Manager", "Accountant", "Finance Manager"],
    summary:
      "Enterprise accounting ledger managing tuition collections, payroll disbursements, facility rent, monthly automated invoicing runs, and overdue suspension audits.",
    icon: DollarSign,
    capabilities: [
      "Comprehensive double-entry transaction ledger with authorized staff collector tracking",
      "Automated Monthly Invoicing engine with projection models and bulk invoice generation",
      "Automated Overdue Suspension Audit triggering soft warnings and inactive flags",
      "Exportable Comprehensive PDF Fiscal Audit Reports and individual player statements",
    ],
    workflows: [
      {
        name: "Executing Monthly Invoicing Run",
        steps: [
          "Navigate to Accounting > Automated Billing tab.",
          "Review the projected revenue calculation based on active player branch fees.",
          "Click 'Generate Monthly Invoices' to issue invoices across the player database.",
          "System logs an append-only audit trail and dispatches invoice notifications.",
        ],
      },
      {
        name: "Running Overdue Suspension Audit",
        steps: [
          "Click 'Audit Overdue Receivables' in the accounting toolbar.",
          "System evaluates player payment history against grace periods.",
          "Overdue players receive soft flags; severely delinquent accounts are marked suspended.",
        ],
      },
    ],
    accessNotes:
      "Restricted strictly to Super Admins, Academy Managers, and authorized Finance Managers.",
    offlineSupport:
      "All financial mutations use Firestore atomic transactions with strict offline safety.",
  },
  {
    id: "personnel",
    title: "Personnel Directory & Document Vault",
    route: "/personnel",
    category: "admin",
    targetRoles: ["Super Admin", "Academy Manager", "HR Manager"],
    summary:
      "Staff administration directory managing coordinators, medical staff, logistics officers, employment contracts, and confidential document vaults.",
    icon: UserCheck,
    capabilities: [
      "Staff directory with roles, departments, emergency contacts, and branch assignments",
      "Confidential document vault for employment contracts, national IDs, and certifications",
      "Compensation terms and contract renewal date reminders",
      "Exportable Staff Directory PDF report",
    ],
    workflows: [
      {
        name: "Uploading Staff Contract",
        steps: [
          "Select staff member and click 'Documents & Credentials'.",
          "Upload PDF or image scan (validated under 15MB file cap).",
          "File is encrypted and stored in tenant-isolated Firebase Cloud Storage.",
        ],
      },
    ],
    accessNotes:
      "Strictly confidential. Visible only to Super Admins and authorized HR administrators.",
    offlineSupport: "Metadata cached locally; file binaries stream on-demand from secure storage.",
  },
  {
    id: "users",
    title: "Users & Role-Based Access Control",
    route: "/users",
    category: "admin",
    targetRoles: ["Super Admin", "Academy Manager"],
    summary:
      "Security administration console for provisioning user credentials (Google Auth & Email/Password), assigning system roles, and enforcing zero-trust permissions.",
    icon: Shield,
    capabilities: [
      "User account provisioning with native Firebase Authentication",
      "RBAC assignment: Super Admin, Academy Manager, Branch Manager, Technical Director, Coach, Accountant",
      "Active account toggle with instant credential deactivation",
      "Zero-trust security: users cannot elevate their own roles in Firestore rules",
    ],
    workflows: [
      {
        name: "Provisioning a New Coach Account",
        steps: [
          "Click 'Add User' in the Users & Access management console.",
          "Enter coach email, full name, assigned branch, and select 'Coach' role.",
          "Set an initial secure password or invite via Google Sign-In.",
          "The coach can now sign in and is immediately routed to the Coach Portal.",
        ],
      },
    ],
    accessNotes: "Restricted strictly to Super Admins and Academy Managers.",
    offlineSupport: "Local user cache allows role checks even during intermittent network drops.",
  },
  {
    id: "settings",
    title: "Academy Customization & WhatsApp Hub",
    route: "/settings",
    category: "admin",
    targetRoles: ["Super Admin", "Academy Manager"],
    summary:
      "Academy branding suite (logo, subdomain, player caps), WhatsApp automated group broadcasts, custom role matrices, and visual theme personalization.",
    icon: Sliders,
    capabilities: [
      "Academy identity: Custom logo upload, name, contact info, currency symbol",
      "WhatsApp Group Manager with direct broadcast links and automated parent templates",
      "Appearance customization: Dark Mode, Light Mode, Pitch Black, and Court orange accents",
      "Player enrollment limit configuration and package subscription renewal tracker",
    ],
    workflows: [
      {
        name: "Setting Up Parent WhatsApp Groups",
        steps: [
          "Go to System Settings > WhatsApp Groups tab.",
          "Create a team broadcast group with branch and coach assignment.",
          "Paste the WhatsApp invite link — parents can join with one tap from their passes.",
          "Use quick-broadcast templates for weather cancellations or schedule shifts.",
        ],
      },
    ],
    accessNotes: "Super Admins and Academy Managers hold complete customization authority.",
    offlineSupport: "Settings sync to local storage and IndexedDB for instantaneous UI rendering.",
  },
  {
    id: "admin",
    title: "Master Platform Client Console",
    route: "/admin",
    category: "admin",
    targetRoles: ["Super Admin (geogo3@gmail.com / jess.chakh22@gmail.com)"],
    summary:
      "Cloud architecture and multi-tenant management console accessible exclusively to master platform owners for tenant switches, health checks, and database oversight.",
    icon: Database,
    capabilities: [
      "Multi-tenant academy switching and instant tenant bootstrap",
      "Global Firestore database health and rules validation checks",
      "Master owner administrative override for technical diagnostics",
      "Audit trail log inspection across all tenants",
    ],
    workflows: [
      {
        name: "Master Platform Inspection",
        steps: [
          "Accessible strictly when signed in as geogo3@gmail.com or jess.chakh22@gmail.com.",
          "Review cross-tenant active player counts and storage utilization.",
          "Inspect security rule enforcement and database connection health.",
        ],
      },
    ],
    accessNotes:
      "Strictly exclusive to master platform owners. Blocked by security rules for all other users.",
    offlineSupport: "Direct cloud telemetry with fallback offline indicators.",
  },
];

const TOUR_STEPS = [
  {
    step: 1,
    title: "Executive Dashboard & Live Cockpit",
    route: "/",
    badge: "Operations",
    icon: Activity,
    description:
      "Begin your day at the Dashboard. Track real-time attendance, monthly revenue projections, court utilization, and player cap capacity in one unified view.",
    highlights: [
      "Instant KPIs: Active players, monthly income, attendance percentage",
      "Live timeline of today's scheduled practices and games",
      "Quick-action links to register players or record expenses",
    ],
  },
  {
    step: 2,
    title: "Calendar Scheduling & Bookings",
    route: "/calendar",
    badge: "Scheduling",
    icon: Calendar,
    description:
      "Orchestrate your academy's entire schedule across branches and courts. Switch seamlessly between Month, Week, and Day views with conflict detection.",
    highlights: [
      "Filter by Branch, Head Coach, Team, or Session Category",
      "Color-coded Practices, Games, Camps, and Seminars",
      "Click any slot to reserve courts and assign coaching staff",
    ],
  },
  {
    step: 3,
    title: "On-Court Sessions & QR Attendance",
    route: "/sessions",
    badge: "Field Work",
    icon: QrCode,
    description:
      "Execute high-speed attendance on the court using your device camera. Scan player QR badges in under 1 second with audible confirmation and medical alerts.",
    highlights: [
      "Camera-based QR badge scanner for contactless check-ins",
      "Present, Absent, Late, and Excused status tracking with timestamps",
      "Link technical practice plans and drill sequences directly to sessions",
    ],
  },
  {
    step: 4,
    title: "Player Registry & Medical Safety",
    route: "/players",
    badge: "Roster",
    icon: Users,
    description:
      "Maintain complete player dossiers with crucial health safety. Amber medical badges highlight allergies, asthma, and injuries to keep players safe.",
    highlights: [
      "Prominent Medical Alerts visible immediately to court staff",
      "Primary & secondary guardian cards with direct WhatsApp buttons",
      "Printable digital Player Pass cards with unique QR codes",
    ],
  },
  {
    step: 5,
    title: "Technical Directorate & Tactical Board",
    route: "/technical",
    badge: "Curriculum",
    icon: PenTool,
    description:
      "Empower your coaching staff with a vector drawing board. Design tactical plays, screen sequences, and passing drills on full or half court layouts.",
    highlights: [
      "Drag-and-drop offensive & defensive player markers",
      "Movement, screen, and ball pass vector drawing tools",
      "Save directly to the academy drill library or export to high-res PDF",
    ],
  },
  {
    step: 6,
    title: "Multi-Branch Operations & Schedules",
    route: "/branches",
    badge: "Facilities",
    icon: Building,
    description:
      "Scale your academy across multiple facilities. Manage court dimensions, surface materials, assigned branch managers, and recurring shift schedules.",
    highlights: [
      "Dynamic Schedule Builder with day-of-week slots and capacity caps",
      "Court inventory tracking (Hardwood, Synthetic, Outdoor)",
      "Branch-specific operational expense ledgers and performance reports",
    ],
  },
  {
    step: 7,
    title: "Financial Ledger & Automated Invoicing",
    route: "/accounting",
    badge: "Finance",
    icon: DollarSign,
    description:
      "Streamline academy revenue with double-entry accounting. Run automated monthly tuition invoicing and overdue audits with automated soft suspension flags.",
    highlights: [
      "Automated Monthly Invoicing engine with projection models",
      "Payment recording with authorized staff collector tracking",
      "Comprehensive PDF financial audits and individual player statements",
    ],
  },
  {
    step: 8,
    title: "Security, RBAC & Offline Reliability",
    route: "/users",
    badge: "Architecture",
    icon: Shield,
    description:
      "Engineered with zero-trust Firestore security rules, append-only immutable audit logs, and multi-tab IndexedDB caching that keeps working even with zero internet.",
    highlights: [
      "Strict Role-Based Access Control preventing unauthorized escalation",
      "Persistent IndexedDB cache enabling 0ms cached loading",
      "Optimistic UI mutations with automatic rollback on network failure",
    ],
  },
];

const FAQS = [
  {
    q: "What happens if our court loses internet connection during practice?",
    a: "Vescio Vector utilizes an advanced IndexedDB persistent local cache. You can continue taking attendance, viewing player medical notes, and reviewing tactical drill diagrams completely offline. When network connection is restored, all mutations automatically sync to the Cloud Firestore database.",
  },
  {
    q: "How do coaches verify and sign off on completed training sessions?",
    a: "In the Coach Portal or Sessions page, coaches tap 'Complete Session' after taking attendance. This logs a verified session timestamp, marking the coach's hours for automatic payroll computation in the Accounting module.",
  },
  {
    q: "How are overdue tuition suspensions automatically calculated?",
    a: "The Accounting module includes an 'Audit Overdue Receivables' engine. It compares player payments against the billing period. If an account is past due, the system sets an amber 'Soft Flag' warning. Delinquent accounts past the grace threshold receive an 'Inactive' suspension tag, notifying managers to restrict attendance.",
  },
  {
    q: "How can parents join their team's WhatsApp broadcast group?",
    a: "In System Settings > WhatsApp Groups, administrators configure group invite links for each team. These links appear directly on the player's digital pass card and parent portal, allowing parents to join with a single tap.",
  },
  {
    q: "Can a user elevate their own role or access unauthorized areas?",
    a: "No. Security is enforced server-side by hardened Firestore Security Rules. The database validates that users cannot alter their own 'role' field during updates, and sub-resources require authenticated membership and proper managerial roles.",
  },
];

function DocumentationPage() {
  const navigate = useNavigate();
  const currentUser = useTenantUser();
  const { user, passwordUser } = useAuth();
  const { db } = useDB();

  const userEmail = (user?.email || passwordUser?.email || currentUser?.email || "").toLowerCase();
  const isMasterOwner = userEmail === "geogo3@gmail.com" || userEmail === "jess.chakh22@gmail.com";
  const userActualRole = currentUser?.role || (isMasterOwner ? "Super Admin" : "User");
  const isSuperAdmin =
    userActualRole === "Super Admin" || userActualRole === "Academy Manager" || isMasterOwner;

  // Viewpoint Lens for Super Admin
  const [selectedLens, setSelectedLens] = useState<string>(() => {
    return isSuperAdmin ? "Super Admin" : userActualRole;
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [isTourModalOpen, setIsTourModalOpen] = useState(false);
  const [currentTourStep, setCurrentTourStep] = useState(0);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Filter modules based on role lens, search, and category
  const filteredModules = useMemo(() => {
    return ALL_MODULES.filter((mod) => {
      // 1. Role Lens Check
      if (selectedLens !== "Super Admin") {
        const matchesRole = mod.targetRoles.some((r) =>
          r.toLowerCase().includes(selectedLens.toLowerCase()),
        );
        if (!matchesRole) return false;
      }

      // 2. Category Check
      if (categoryFilter !== "all" && mod.category !== categoryFilter) {
        return false;
      }

      // 3. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inTitle = mod.title.toLowerCase().includes(q);
        const inSummary = mod.summary.toLowerCase().includes(q);
        const inCaps = mod.capabilities.some((c) => c.toLowerCase().includes(q));
        const inWorkflows = mod.workflows.some(
          (w) =>
            w.name.toLowerCase().includes(q) || w.steps.some((s) => s.toLowerCase().includes(q)),
        );
        if (!inTitle && !inSummary && !inCaps && !inWorkflows) return false;
      }

      return true;
    });
  }, [selectedLens, categoryFilter, searchQuery]);

  // Export Complete PDF Manual
  const handleDownloadFullManual = async () => {
    try {
      setIsGeneratingPdf(true);
      toast.info("Generating comprehensive Academy Operations Manual PDF...");

      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const academyName = db.academy?.name || "Vescio Vector Basketball Academy";
      const totalPagesExp = "{total_pages_count_string}";

      // Page 1: Cover & Header
      // Top Dark Banner
      doc.setFillColor(15, 23, 42); // slate-900
      doc.rect(0, 0, 210, 36, "F");

      // Orange Accent Line
      doc.setFillColor(249, 115, 22); // orange-500
      doc.rect(0, 36, 210, 2, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(255, 255, 255);
      doc.text("VESCIO VECTOR · OFFICIAL SOFTWARE MANUAL", 14, 15);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(249, 115, 22);
      doc.text("CLOUD BASKETBALL ACADEMY OPERATING SYSTEM", 14, 22);

      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text(
        `Academy: ${academyName}  |  Target Scope: ${selectedLens.toUpperCase()}  |  Date: ${new Date().toLocaleDateString()}`,
        14,
        30,
      );

      let yPos = 48;

      // Executive Brief
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text("1. Executive System Overview & Scope of Access", 14, yPos);
      yPos += 7;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      const introText =
        selectedLens === "Super Admin"
          ? "This master manual documents the complete operating capabilities of Vescio Vector. As Super Administrator, your account holds unrestricted authority across Executive Governance, Financial Accounting, Multi-Branch Facilities, Technical Directorate, Player Safety, and Cloud Security."
          : `This operations guide is tailored specifically to the ${selectedLens} role. It highlights authorized workflows, on-court procedures, security responsibilities, and emergency protocols applicable to your day-to-day operations.`;
      const splitIntro = doc.splitTextToSize(introText, 182);
      doc.text(splitIntro, 14, yPos);
      yPos += splitIntro.length * 5 + 6;

      // Section 2: Core Modules & Workflows
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text("2. Service Modules & Standard Operating Procedures", 14, yPos);
      yPos += 7;

      // Loop through filtered modules
      filteredModules.forEach((mod, idx) => {
        // Check page overflow
        if (yPos > 240) {
          doc.addPage();
          // Header on subsequent pages
          doc.setFillColor(15, 23, 42);
          doc.rect(0, 0, 210, 16, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          doc.setTextColor(255, 255, 255);
          doc.text(`VESCIO VECTOR · ${academyName.toUpperCase()}`, 14, 11);
          yPos = 26;
        }

        // Module Box
        doc.setFillColor(248, 250, 252); // slate-50
        doc.setDrawColor(226, 232, 240); // slate-200
        doc.roundedRect(14, yPos, 182, 38, 2, 2, "FD");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42);
        doc.text(`${idx + 1}. ${mod.title} (${mod.route})`, 18, yPos + 7);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(249, 115, 22);
        doc.text(`Target Roles: ${mod.targetRoles.join(", ")}`, 18, yPos + 12);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        const splitSummary = doc.splitTextToSize(mod.summary, 174);
        doc.text(splitSummary, 18, yPos + 18);

        // Core Capabilities bullet
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(15, 23, 42);
        doc.text("Core Features:", 18, yPos + 27);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(51, 65, 85);
        const capStr = mod.capabilities.slice(0, 2).join(" · ");
        const splitCaps = doc.splitTextToSize(capStr, 148);
        doc.text(splitCaps, 40, yPos + 27);

        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(`Offline Mode: ${mod.offlineSupport}`, 18, yPos + 34);

        yPos += 42;
      });

      // Section 3: Role-Based Access Control Table (AutoTable)
      if (yPos > 210) {
        doc.addPage();
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 210, 16, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(255, 255, 255);
        doc.text(`VESCIO VECTOR · ${academyName.toUpperCase()}`, 14, 11);
        yPos = 26;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text("3. Role-Based Access Control (RBAC) Authority Matrix", 14, yPos);
      yPos += 6;

      const rbacHeaders = [
        "Software Service",
        "Super Admin",
        "Branch Manager",
        "Technical Director",
        "Coach",
        "Accountant",
      ];
      const rbacData = [
        ["Executive Dashboard", "Full", "Branch Only", "Restricted", "No Access", "Ledger View"],
        [
          "Calendar & Booking",
          "Author",
          "Author (Branch)",
          "View Only",
          "View Assigned",
          "View Only",
        ],
        ["Sessions & Attendance", "Full", "Full", "View Drills", "Mark & Sign", "View Attendance"],
        [
          "Player Health & Medical",
          "Full",
          "Full",
          "Roster View",
          "Medical Alerts",
          "Billing Info",
        ],
        ["Tactical Drawing Board", "Full", "View Only", "Full Author", "View Drills", "No Access"],
        ["Branch Shift Builder", "Full", "Configure Branch", "No Access", "No Access", "No Access"],
        [
          "Accounting & Invoicing",
          "Full",
          "Local Expenses",
          "No Access",
          "No Access",
          "Full Ledger",
        ],
        ["Merchandise & POS", "Full", "Branch POS", "No Access", "No Access", "Full Ledger"],
        ["Users & Access Control", "Full", "No Access", "No Access", "No Access", "No Access"],
        [
          "Platform Client Console",
          "Master Owner",
          "No Access",
          "No Access",
          "No Access",
          "No Access",
        ],
      ];

      autoTable(doc, {
        startY: yPos,
        head: [rbacHeaders],
        body: rbacData,
        theme: "striped",
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontSize: 7.5,
          fontStyle: "bold",
        },
        bodyStyles: {
          fontSize: 7,
          textColor: [51, 65, 85],
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        margin: { left: 14, right: 14 },
      });

      // Add Page Numbers & Footers
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(148, 163, 184);
        doc.text(
          `Vescio Vector Cloud Platform · Confidential · Page ${i} of ${totalPages}`,
          14,
          290,
        );
        doc.text(`Authorized for ${selectedLens}`, 170, 290);
      }

      doc.save(`Vescio_Vector_Manual_${selectedLens.replace(/\s+/g, "_")}.pdf`);
      toast.success("Operations Manual PDF downloaded successfully!");
    } catch (err) {
      console.error("PDF generation failed:", err);
      toast.error("Failed to generate PDF manual. Please try again.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // Export Quick Field Guide Cheat Sheet
  const handleDownloadFieldCheatSheet = async () => {
    try {
      setIsGeneratingPdf(true);
      toast.info("Generating Quick Reference Field Guide...");

      const { default: jsPDF } = await import("jspdf");

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const academyName = db.academy?.name || "Vescio Vector Academy";

      // Header Banner
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, 210, 28, "F");
      doc.setFillColor(249, 115, 22);
      doc.rect(0, 28, 210, 2, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(255, 255, 255);
      doc.text("VESCIO VECTOR · ON-COURT FIELD GUIDE", 14, 12);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(249, 115, 22);
      doc.text(`QUICK REFERENCE CHEAT SHEET · ROLE: ${selectedLens.toUpperCase()}`, 14, 18);
      doc.setTextColor(148, 163, 184);
      doc.text(`Academy: ${academyName}  |  Issued: ${new Date().toLocaleDateString()}`, 14, 24);

      let yPos = 38;

      // Section 1: Morning & Pre-Session Checklist
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text("1. Pre-Session Setup & Readiness Protocol", 14, yPos);
      yPos += 6;

      const checklist = [
        "1. Open Calendar (/calendar) to confirm assigned court, team division, and scheduled drills.",
        "2. Check Player Medical Alerts (/players) for players with asthma, allergies, or physical restrictions.",
        "3. Launch Camera Attendance Scanner (/sessions) for instant QR badge arrival verification.",
        "4. Review the Tactical Board drill sequence (/technical) attached to the current practice block.",
        "5. For merchandise sales, process uniform pickups atomically via the POS module (/merchandise).",
      ];

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(51, 65, 85);
      checklist.forEach((item) => {
        doc.text(item, 16, yPos);
        yPos += 5.5;
      });

      yPos += 4;

      // Section 2: Emergency Response & Medical Protocol
      doc.setFillColor(254, 242, 242); // red-50
      doc.setDrawColor(254, 202, 202); // red-200
      doc.roundedRect(14, yPos, 182, 36, 2, 2, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(185, 28, 28); // red-700
      doc.text("CRITICAL: On-Court Emergency & Medical Procedure", 18, yPos + 7);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(127, 29, 29);
      doc.text(
        "• If a player is injured or suffers a medical incident, open their player dossier immediately.",
        18,
        yPos + 13,
      );
      doc.text(
        "• Emergency Medical Notes and dietary/health conditions are permanently highlighted in amber.",
        18,
        yPos + 18,
      );
      doc.text(
        "• Tap the Guardian 1 or Guardian 2 card to immediately launch an urgent WhatsApp call or message.",
        18,
        yPos + 23,
      );
      doc.text(
        "• Log the incident in the session notes to preserve an immutable administrative record.",
        18,
        yPos + 28,
      );

      yPos += 44;

      // Section 3: Offline Synchronization Best Practices
      doc.setFillColor(240, 253, 244); // emerald-50
      doc.setDrawColor(187, 247, 208); // emerald-200
      doc.roundedRect(14, yPos, 182, 34, 2, 2, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(21, 128, 61); // emerald-700
      doc.text("Offline Resilience & Zero Cellular Signal Best Practices", 18, yPos + 7);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(20, 83, 45);
      doc.text(
        "• Vescio Vector keeps an encrypted IndexedDB database locally on your phone or tablet.",
        18,
        yPos + 13,
      );
      doc.text(
        "• You can safely record player attendance, complete sessions, and view drill diagrams offline.",
        18,
        yPos + 18,
      );
      doc.text(
        "• Do not close your browser tab until returning to WiFi/cellular to allow automatic sync.",
        18,
        yPos + 23,
      );
      doc.text(
        "• Changes sync seamlessly with server-side optimistic verification.",
        18,
        yPos + 28,
      );

      yPos += 42;

      // Section 4: Key Navigation Shortcuts
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.text("4. Software Direct Navigation Pathways", 14, yPos);
      yPos += 6;

      const shortcuts = [
        "• Main Dashboard: / (Real-time attendance & revenue cockpit)",
        "• Calendar Schedule: /calendar (Month, Week, Day court booking views)",
        "• Sessions & QR: /sessions (Live camera scanner and attendance sign-off)",
        "• Player Dossiers: /players (Emergency medical notes & digital pass cards)",
        "• Coach Field App: /coach (Mobile-first court interface for coaches)",
        "• Tactical Board: /technical (Drill library and practice plan authoring)",
        "• Financial Ledger: /accounting (Tuition invoicing and collection audits)",
      ];

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      shortcuts.forEach((sc) => {
        doc.text(sc, 16, yPos);
        yPos += 4.5;
      });

      // Footer
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Vescio Vector Basketball Operating System · Emergency Support Hotline: support@vesciovector.com`,
        14,
        288,
      );

      doc.save(`Vescio_Vector_Field_Guide_${selectedLens.replace(/\s+/g, "_")}.pdf`);
      toast.success("Quick Reference Field Guide PDF downloaded successfully!");
    } catch (err) {
      console.error("Field guide generation failed:", err);
      toast.error("Failed to generate Field Guide PDF.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleNextStep = () => {
    if (currentTourStep < TOUR_STEPS.length - 1) {
      setCurrentTourStep((s) => s + 1);
    } else {
      setIsTourModalOpen(false);
      toast.success("Interactive tour complete! Explore the modules below.");
    }
  };

  const handlePrevStep = () => {
    if (currentTourStep > 0) {
      setCurrentTourStep((s) => s - 1);
    }
  };

  const currentStepData = TOUR_STEPS[currentTourStep];

  return (
    <AppShell crumb="SUPPORT · KNOWLEDGE BASE" title="Documentation & Software Tour">
      <div className="space-y-8 max-w-7xl mx-auto pb-12">
        {/* Top Hero Banner */}
        <div className="relative overflow-hidden rounded-2xl border border-ink-800 bg-gradient-to-br from-ink-900 via-ink-950 to-ink-900 p-6 lg:p-8 shadow-xl">
          <div className="absolute right-0 top-0 -mt-6 -mr-6 h-64 w-64 rounded-full bg-court-500/10 blur-3xl pointer-events-none" />

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
            <div className="space-y-2 max-w-2xl">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-court-400 tracking-wider uppercase">
                  Vescio Vector Knowledge Base
                </span>
                <span className="text-ink-600">·</span>
                <span className="text-xs text-ink-300 font-medium">
                  Active User: {user?.displayName || currentUser?.name || userEmail} (
                  {userActualRole})
                </span>
              </div>
              <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-ink-100 font-display">
                Complete Academy Software Manual & Interactive Tour
              </h2>
              <p className="text-sm text-ink-300 leading-relaxed">
                Explore comprehensive operational workflows, on-court check-in protocols, tactical
                playbook authoring, and financial controls tailored specifically to your authorized
                access level.
              </p>
            </div>

            {/* Top Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setCurrentTourStep(0);
                  setIsTourModalOpen(true);
                }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-court-500 hover:bg-court-400 text-ink-950 font-semibold text-xs transition-all shadow-md cursor-pointer"
              >
                <Compass className="w-4 h-4 text-ink-950" />
                <span>Start Interactive Tour</span>
              </button>

              <button
                type="button"
                disabled={isGeneratingPdf}
                onClick={handleDownloadFullManual}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-ink-800 hover:bg-ink-750 text-ink-100 ring-1 ring-ink-700 font-medium text-xs transition-all cursor-pointer disabled:opacity-50"
              >
                <Download className="w-4 h-4 text-court-400" />
                <span>Download Manual (PDF)</span>
              </button>

              <button
                type="button"
                disabled={isGeneratingPdf}
                onClick={handleDownloadFieldCheatSheet}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-ink-850 hover:bg-ink-800 text-ink-300 ring-1 ring-ink-700 font-medium text-xs transition-all cursor-pointer disabled:opacity-50"
              >
                <FileText className="w-4 h-4 text-ink-400" />
                <span>Field Guide (PDF)</span>
              </button>
            </div>
          </div>

          {/* Role Viewpoint Lens (For Super Admin & Managers) */}
          {isSuperAdmin && (
            <div className="mt-6 pt-6 border-t border-ink-800/80">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-ink-300">
                  <Shield className="w-4 h-4 text-court-400" />
                  <span className="font-semibold text-ink-100">Super Admin Perspective Lens:</span>
                  <span className="text-ink-400 hidden md:inline">
                    Toggle to preview the platform documentation as experienced by other roles:
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 p-1 bg-ink-950/80 rounded-lg border border-ink-800">
                  {[
                    "Super Admin",
                    "Coach",
                    "Technical Director",
                    "Branch Manager",
                    "Accountant",
                  ].map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setSelectedLens(role)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                        selectedLens === role
                          ? "bg-court-500 text-ink-950 font-bold shadow-sm"
                          : "text-ink-300 hover:text-ink-100 hover:bg-ink-800"
                      }`}
                    >
                      {role === "Super Admin" ? "All Services (Full View)" : role}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Quick Highlights Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-ink-400">CURRENT VIEWPOINT</span>
              <Award className="w-4 h-4 text-court-400" />
            </div>
            <div className="text-lg font-bold text-ink-100 font-display">{selectedLens}</div>
            <div className="text-xs text-ink-400">
              {selectedLens === "Super Admin"
                ? "Full unrestricted access across all 13 modules"
                : `Customized guide for ${selectedLens} workflows`}
            </div>
          </div>

          <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-ink-400">ACTIVE MODULES</span>
              <Layers className="w-4 h-4 text-court-400" />
            </div>
            <div className="text-lg font-bold text-ink-100 font-display">
              {filteredModules.length} Modules Available
            </div>
            <div className="text-xs text-ink-400">Interactive guides with instant launch links</div>
          </div>

          <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-ink-400">OFFLINE RESILIENCE</span>
              <WifiOff className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-lg font-bold text-ink-100 font-display">IndexedDB Multi-Tab</div>
            <div className="text-xs text-emerald-400/80">Zero-downtime offline cache on courts</div>
          </div>

          <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-ink-400">DATA SECURITY</span>
              <Lock className="w-4 h-4 text-court-400" />
            </div>
            <div className="text-lg font-bold text-ink-100 font-display">Zero-Trust ABAC</div>
            <div className="text-xs text-ink-400">Immutable audit logs & role protection</div>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-2">
          {/* Category Filter Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-ink-900/80 border border-ink-800 rounded-lg">
            {[
              { id: "all", label: "All Modules" },
              { id: "operations", label: "Operations & On-Court" },
              { id: "technical", label: "Technical & Coaching" },
              { id: "financial", label: "Financials & POS" },
              { id: "admin", label: "Administration & Security" },
            ].map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  categoryFilter === cat.id
                    ? "bg-court-500 text-ink-950 font-bold"
                    : "text-ink-400 hover:text-ink-200"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative min-w-[260px]">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search workflows, QR, drills, billing…"
              className="w-full rounded-lg bg-ink-900 border border-ink-800 py-2 pl-9 pr-3 text-xs text-ink-100 placeholder:text-ink-500 focus:outline-none focus:ring-1 focus:ring-court-500"
            />
            <Search className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" />
          </div>
        </div>

        {/* Modules Directory Cards */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-ink-100 font-display">
              Software Services Directory ({filteredModules.length})
            </h3>
            <span className="text-xs text-ink-400">
              Filtered for <span className="text-court-400 font-semibold">{selectedLens}</span>
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {filteredModules.map((mod) => {
              const IconComp = mod.icon;
              return (
                <div
                  key={mod.id}
                  className="rounded-xl border border-ink-800 bg-ink-900/40 hover:border-ink-700 transition-all p-5 flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-court-500/10 border border-court-500/20 flex items-center justify-center shrink-0">
                          <IconComp className="w-5 h-5 text-court-400" />
                        </div>
                        <div>
                          <h4 className="text-base font-semibold text-ink-100">{mod.title}</h4>
                          <span className="font-mono text-[11px] text-court-400">{mod.route}</span>
                        </div>
                      </div>

                      <Link
                        to={mod.route}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-ink-800 hover:bg-ink-750 text-ink-200 text-xs font-medium ring-1 ring-ink-700 transition-colors"
                      >
                        <span>Open Module</span>
                        <ArrowRight className="w-3.5 h-3.5 text-court-400" />
                      </Link>
                    </div>

                    {/* Summary */}
                    <p className="text-xs text-ink-300 leading-relaxed">{mod.summary}</p>

                    {/* Capabilities List */}
                    <div className="space-y-1.5 pt-2 border-t border-ink-800/60">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-ink-400">
                        Key Capabilities
                      </span>
                      <ul className="space-y-1">
                        {mod.capabilities.map((cap, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-ink-300">
                            <CheckCircle2 className="w-3.5 h-3.5 text-court-400 shrink-0 mt-0.5" />
                            <span>{cap}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Standard Operating Workflow */}
                    {mod.workflows.length > 0 && (
                      <div className="rounded-lg bg-ink-950/70 border border-ink-800/80 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Flame className="w-3.5 h-3.5 text-court-400" />
                          <span className="text-xs font-semibold text-ink-200">
                            Workflow: {mod.workflows[0].name}
                          </span>
                        </div>
                        <ol className="list-decimal list-inside space-y-1 text-xs text-ink-400">
                          {mod.workflows[0].steps.map((step, idx) => (
                            <li key={idx} className="leading-relaxed">
                              {step}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>

                  {/* Footer Metadata */}
                  <div className="pt-3 border-t border-ink-800/60 flex flex-wrap items-center justify-between text-[11px] text-ink-400 gap-2">
                    <div className="flex items-center gap-1">
                      <Lock className="w-3 h-3 text-ink-500" />
                      <span>{mod.accessNotes}</span>
                    </div>
                    <div className="flex items-center gap-1 text-emerald-400/80">
                      <WifiOff className="w-3 h-3" />
                      <span>{mod.offlineSupport}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Interactive RBAC Access Matrix */}
        <div className="rounded-2xl border border-ink-800 bg-ink-900/40 p-6 lg:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold text-ink-100 font-display">
                Role-Based Access Control (RBAC) Architecture
              </h3>
              <p className="text-xs text-ink-400 mt-1">
                Security is enforced at the database layer via Cloud Firestore security rules. No
                role can bypass access gates.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-court-400 font-mono">
              <Shield className="w-4 h-4" />
              <span>Zero-Trust Enforced</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-ink-800 bg-ink-950/60 text-ink-400 font-mono text-[11px]">
                  <th className="py-3 px-4 font-semibold">Software Module</th>
                  <th className="py-3 px-4 font-semibold">Super Admin</th>
                  <th className="py-3 px-4 font-semibold">Branch Manager</th>
                  <th className="py-3 px-4 font-semibold">Technical Director</th>
                  <th className="py-3 px-4 font-semibold">Coach</th>
                  <th className="py-3 px-4 font-semibold">Accountant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800/60">
                {[
                  {
                    mod: "Executive Cockpit (/)",
                    sa: "Full Access",
                    bm: "Branch Scope",
                    td: "Restricted",
                    co: "No Access",
                    ac: "Ledger View",
                  },
                  {
                    mod: "Dynamic Calendar (/calendar)",
                    sa: "Full Author",
                    bm: "Branch Author",
                    td: "View Only",
                    co: "Assigned Sessions",
                    ac: "View Only",
                  },
                  {
                    mod: "Sessions & QR Scanner (/sessions)",
                    sa: "Full Author",
                    bm: "Full Author",
                    td: "Drill Linking",
                    co: "Check-in & Sign-off",
                    ac: "Attendance View",
                  },
                  {
                    mod: "Players & Medical (/players)",
                    sa: "Full Access",
                    bm: "Full Access",
                    td: "Roster View",
                    co: "Medical Alerts",
                    ac: "Billing Info",
                  },
                  {
                    mod: "Technical Board (/technical)",
                    sa: "Full Access",
                    bm: "View Only",
                    td: "Director Author",
                    co: "View Drills",
                    ac: "No Access",
                  },
                  {
                    mod: "Dedicated Coach App (/coach)",
                    sa: "Full Access",
                    bm: "No Access",
                    td: "View Only",
                    co: "Mobile Portal",
                    ac: "No Access",
                  },
                  {
                    mod: "Branch Shift Builder (/branches)",
                    sa: "Full Access",
                    bm: "Branch Configure",
                    td: "No Access",
                    co: "No Access",
                    ac: "No Access",
                  },
                  {
                    mod: "Financial Accounting (/accounting)",
                    sa: "Full Ledger",
                    bm: "Branch Expenses",
                    td: "No Access",
                    co: "No Access",
                    ac: "Full Ledger",
                  },
                  {
                    mod: "Merchandise & POS (/merchandise)",
                    sa: "Full Access",
                    bm: "Branch POS",
                    td: "No Access",
                    co: "No Access",
                    ac: "Full Ledger",
                  },
                  {
                    mod: "User Management (/users)",
                    sa: "Full Access",
                    bm: "No Access",
                    td: "No Access",
                    co: "No Access",
                    ac: "No Access",
                  },
                  {
                    mod: "System Settings (/settings)",
                    sa: "Full Access",
                    bm: "No Access",
                    td: "No Access",
                    co: "No Access",
                    ac: "No Access",
                  },
                ].map((row, i) => (
                  <tr key={i} className="hover:bg-ink-850/40 transition-colors">
                    <td className="py-3 px-4 font-medium text-ink-100">{row.mod}</td>
                    <td className="py-3 px-4 text-emerald-400 font-semibold">{row.sa}</td>
                    <td className="py-3 px-4 text-ink-300">{row.bm}</td>
                    <td className="py-3 px-4 text-ink-300">{row.td}</td>
                    <td className="py-3 px-4 text-court-400">{row.co}</td>
                    <td className="py-3 px-4 text-ink-300">{row.ac}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Frequently Asked Questions */}
        <div className="rounded-2xl border border-ink-800 bg-ink-900/40 p-6 lg:p-8 space-y-5">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-court-400" />
            <h3 className="text-xl font-bold text-ink-100 font-display">
              Frequently Asked Questions & Operational Guidelines
            </h3>
          </div>

          <div className="space-y-3 pt-2">
            {FAQS.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div
                  key={idx}
                  className="rounded-xl border border-ink-800 bg-ink-950/60 overflow-hidden transition-all"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between p-4 text-left font-medium text-sm text-ink-100 hover:text-court-400 transition-colors cursor-pointer"
                  >
                    <span>{faq.q}</span>
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4 text-court-400 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-ink-500 shrink-0" />
                    )}
                  </button>
                  {isOpen && (
                    <div className="p-4 pt-0 text-xs text-ink-300 leading-relaxed border-t border-ink-850">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Interactive Guided Tour Modal */}
      {isTourModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-950/80 backdrop-blur-md">
          <div className="relative w-full max-w-2xl rounded-2xl border border-ink-700 bg-ink-900 p-6 lg:p-8 shadow-2xl space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-ink-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-court-500/15 border border-court-500/30 flex items-center justify-center text-court-400">
                  {currentStepData && <currentStepData.icon className="w-5 h-5" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-court-400 uppercase tracking-widest">
                      STEP {currentStepData?.step} OF {TOUR_STEPS.length}
                    </span>
                    <span className="text-ink-600">·</span>
                    <span className="text-[10px] font-semibold text-ink-300 bg-ink-800 px-2 py-0.5 rounded">
                      {currentStepData?.badge}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-ink-100 font-display">
                    {currentStepData?.title}
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsTourModalOpen(false)}
                className="text-ink-400 hover:text-ink-100 text-sm font-mono cursor-pointer"
              >
                ✕ Close
              </button>
            </div>

            {/* Tour Body */}
            <div className="space-y-4">
              <p className="text-sm text-ink-200 leading-relaxed">{currentStepData?.description}</p>

              <div className="rounded-xl border border-ink-800 bg-ink-950/80 p-4 space-y-2">
                <span className="text-[10px] font-mono text-ink-400 uppercase tracking-wider">
                  Operational Highlights
                </span>
                <ul className="space-y-1.5">
                  {currentStepData?.highlights.map((h, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-ink-300">
                      <CheckCircle2 className="w-4 h-4 text-court-400 shrink-0 mt-0.5" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Tour Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] font-mono text-ink-400">
                <span>Tour Progress</span>
                <span>{Math.round(((currentTourStep + 1) / TOUR_STEPS.length) * 100)}%</span>
              </div>
              <div className="h-1.5 w-full bg-ink-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-court-500 transition-all duration-300"
                  style={{
                    width: `${((currentTourStep + 1) / TOUR_STEPS.length) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* Modal Controls */}
            <div className="flex items-center justify-between pt-2 border-t border-ink-800">
              <button
                type="button"
                onClick={handlePrevStep}
                disabled={currentTourStep === 0}
                className="px-3.5 py-2 rounded-lg bg-ink-800 hover:bg-ink-750 text-xs font-semibold text-ink-300 disabled:opacity-30 cursor-pointer"
              >
                Previous Step
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsTourModalOpen(false);
                    navigate({ to: currentStepData.route });
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-ink-800 hover:bg-ink-750 text-xs font-semibold text-court-400 ring-1 ring-ink-700 cursor-pointer"
                >
                  <span>Jump to Live Page</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={handleNextStep}
                  className="px-4 py-2 rounded-lg bg-court-500 hover:bg-court-400 text-xs font-bold text-ink-950 cursor-pointer"
                >
                  {currentTourStep === TOUR_STEPS.length - 1 ? "Finish Tour" : "Next Step"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

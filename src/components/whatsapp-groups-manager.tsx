import { useState, useMemo } from "react";
import {
  useDB,
  useTenantUser,
  useModulePermissions,
  defaultRoleDefinitions,
  resolveWhatsAppGroupMembers,
  type WhatsAppGroup,
  type WhatsAppGroupCategory,
  type WhatsAppGroupScopeType,
  type WhatsAppGroupMemberPhone,
} from "@/lib/data-store";
import { formatWhatsAppPhone, openDirectWhatsApp } from "@/lib/whatsapp";
import {
  Panel,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  Modal,
  Chip,
  EmptyState,
} from "@/components/kit";
import { QRCodeSVG } from "qrcode.react";
import {
  MessageSquare,
  Plus,
  Edit2,
  Trash2,
  ExternalLink,
  Copy,
  Check,
  QrCode,
  Search,
  Users,
  ShieldAlert,
  Phone,
  Link2,
  AlertCircle,
  Building,
  Trophy,
  CheckCircle2,
  X,
  UserPlus,
  GraduationCap,
} from "lucide-react";
import { toast } from "sonner";

export interface WhatsAppGroupsManagerProps {
  embedded?: boolean;
  filterBranchId?: string;
  filterTeamId?: string;
  title?: string;
  onSelectGroup?: (group: WhatsAppGroup) => void;
}

const CATEGORY_CONFIG: Record<
  WhatsAppGroupCategory,
  { label: string; icon: string; tone: "accent" | "good" | "warn" | "bad" | "neutral" }
> = {
  Games: { label: "Games & Results", icon: "🏆", tone: "accent" },
  Sessions: { label: "Training & Sessions", icon: "🏀", tone: "good" },
  Parents: { label: "Parents & Community", icon: "👨‍👩‍👧", tone: "warn" },
  Coaches: { label: "Coaches & Staff", icon: "📋", tone: "accent" },
  General: { label: "General Broadcast", icon: "📢", tone: "neutral" },
  Emergency: { label: "Emergency & Weather", icon: "🚨", tone: "bad" },
};

export function WhatsAppGroupsManager({
  embedded = false,
  filterBranchId,
  filterTeamId,
  title = "WhatsApp Group Links & Communications",
  onSelectGroup,
}: WhatsAppGroupsManagerProps) {
  const { db, update } = useDB();
  const currentUser = useTenantUser();
  const teamPerms = useModulePermissions("teams");
  const settingsPerms = useModulePermissions("settings");

  const isManagerOrHigher =
    currentUser?.role === "Super Admin" ||
    currentUser?.role === "Academy Manager" ||
    currentUser?.role === "Technical Director" ||
    currentUser?.role === "Branch Manager";

  const isReadOnlyRole =
    !isManagerOrHigher &&
    (currentUser?.role === "Staff" ||
      currentUser?.role === "Accountant" ||
      currentUser?.role === "Coach");
  const canWrite =
    isManagerOrHigher || (!isReadOnlyRole && (teamPerms.write || settingsPerms.write));
  const canDelete =
    isManagerOrHigher || (!isReadOnlyRole && (teamPerms.delete || settingsPerms.delete));

  const activeRolesMatrix =
    db.customRoles && db.customRoles.length > 0 ? db.customRoles : defaultRoleDefinitions;
  const matchedRoleDef = activeRolesMatrix.find((r) => r.role === currentUser?.role);
  const isBranchScoped = Boolean(
    currentUser?.branch &&
    currentUser.branch !== "All branches" &&
    currentUser.branch !== "HQ" &&
    (currentUser.role === "Branch Manager" ||
      matchedRoleDef?.branchScope === "Assigned branch only"),
  );
  const assignedBranchName = isBranchScoped ? currentUser?.branch || "" : "";
  const assignedBranchObj = useMemo(
    () =>
      assignedBranchName
        ? db.branches.find((b) => b.name.toLowerCase() === assignedBranchName.toLowerCase())
        : undefined,
    [assignedBranchName, db.branches],
  );

  const scopedBranches = useMemo(() => {
    if (!isBranchScoped) return db.branches;
    return db.branches.filter(
      (b) =>
        b.id === assignedBranchObj?.id || b.name.toLowerCase() === assignedBranchName.toLowerCase(),
    );
  }, [db.branches, isBranchScoped, assignedBranchObj?.id, assignedBranchName]);

  const scopedTeams = useMemo(() => {
    if (!isBranchScoped) return db.teams;
    return db.teams.filter(
      (t) => (t.branch || "").toLowerCase() === assignedBranchName.toLowerCase(),
    );
  }, [db.teams, isBranchScoped, assignedBranchName]);

  const coachLevels = useMemo(() => {
    const fromLists = db.lists?.["Coaching levels"] || db.lists?.["Coach levels"] || [];
    const fromCoaches = (db.coaches || [])
      .map((c) => c.level)
      .filter((lvl): lvl is string => Boolean(lvl && lvl.trim()));
    const combined = Array.from(
      new Set([
        "All Coaches",
        ...fromLists,
        ...fromCoaches,
        "Head Coach",
        "Assistant Coach",
        "Trainer",
      ]),
    );
    return combined;
  }, [db.lists, db.coaches]);

  const scopedBaseGroups = useMemo(() => {
    const all = db.groups || [];
    if (!isBranchScoped) return all;
    const myTeamIds = new Set(scopedTeams.map((t) => t.id));
    const myTeamNames = new Set(scopedTeams.map((t) => t.name.toLowerCase()));
    const bLower = assignedBranchName.toLowerCase();
    return all.filter((g) => {
      if (assignedBranchObj && g.branchId === assignedBranchObj.id) return true;
      if (g.branchName && g.branchName.toLowerCase() === bLower) return true;
      if (g.teamId && myTeamIds.has(g.teamId)) return true;
      if (g.teamName && myTeamNames.has(g.teamName.toLowerCase())) return true;
      if (g.scopeType === "coach_level" || g.coachLevel) return true;
      if (!g.branchId && !g.branchName && !g.teamId && !g.teamName) {
        return Boolean(g.scope && g.scope.toLowerCase().includes(bLower));
      }
      return false;
    });
  }, [db.groups, isBranchScoped, scopedTeams, assignedBranchName, assignedBranchObj]);

  // Search & Filter state
  const [search, setSearch] = useState("");
  const [selectedBranch, setSelectedBranch] = useState(
    filterBranchId || (isBranchScoped && assignedBranchObj ? assignedBranchObj.id : "All"),
  );
  const [selectedTeam, setSelectedTeam] = useState(filterTeamId || "All");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [linkFilter, setLinkFilter] = useState<"All" | "WithLink" | "MissingLink">("All");

  // CRUD Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<WhatsAppGroup | null>(null);

  // Expanded group ID for viewing/adding phone numbers directly on the card
  const [expandedRosterGroupId, setExpandedRosterGroupId] = useState<string | null>(null);

  // Manual phone draft inside modal or card
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualRole, setManualRole] = useState("Parent / Guardian");

  // Delete confirmation state
  const [deletingGroup, setDeletingGroup] = useState<WhatsAppGroup | null>(null);

  // QR Code Preview modal state
  const [qrModalGroup, setQrModalGroup] = useState<WhatsAppGroup | null>(null);

  // Form State
  const [form, setForm] = useState<{
    name: string;
    scopeType: WhatsAppGroupScopeType;
    branchId: string;
    teamId: string;
    coachLevel: string;
    customScope: string;
    link: string;
    category: WhatsAppGroupCategory;
    adminPhone: string;
    contactName: string;
    description: string;
    active: boolean;
    manualMembers: WhatsAppGroupMemberPhone[];
    excludedAutoPhones: string[];
  }>({
    name: "",
    scopeType: "team",
    branchId: assignedBranchObj?.id || scopedBranches[0]?.id || "",
    teamId: scopedTeams[0]?.id || "",
    coachLevel: coachLevels[0] || "All Coaches",
    customScope: "",
    link: "",
    category: "Games",
    adminPhone: "",
    contactName: "",
    description: "",
    active: true,
    manualMembers: [],
    excludedAutoPhones: [],
  });

  // Copied indicator state for specific group ids
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedQr, setCopiedQr] = useState(false);

  // Live preview of resolved members inside the Add/Edit Modal
  const modalPreviewMembers = useMemo(() => {
    const selectedB = db.branches.find((br) => br.id === form.branchId);
    const selectedT = db.teams.find((tm) => tm.id === form.teamId);
    const previewGroup: WhatsAppGroup = {
      id: editingGroup?.id || "preview",
      name: form.name || "Preview",
      scopeType: form.scopeType,
      branchId:
        form.scopeType === "branch" || form.scopeType === "coach_level"
          ? form.branchId || undefined
          : undefined,
      branchName:
        form.scopeType === "branch" || form.scopeType === "coach_level"
          ? selectedB?.name
          : form.scopeType === "team"
            ? selectedT?.branch
            : undefined,
      teamId: form.scopeType === "team" ? form.teamId : undefined,
      teamName: form.scopeType === "team" ? selectedT?.name : undefined,
      coachLevel: form.scopeType === "coach_level" ? form.coachLevel : undefined,
      manualMembers: form.manualMembers,
      excludedAutoPhones: form.excludedAutoPhones,
    };
    const resolved = resolveWhatsAppGroupMembers(previewGroup, db);
    return Array.isArray(resolved) ? resolved : [];
  }, [form, editingGroup, db]);

  // Filtered Groups
  const filteredGroups = useMemo(() => {
    return scopedBaseGroups.filter((g) => {
      // Scope Branch Filter
      if (selectedBranch !== "All") {
        const matchesBranchId = g.branchId === selectedBranch;
        const branchObj = db.branches.find((b) => b.id === selectedBranch);
        const matchesBranchName =
          branchObj &&
          (g.branchName?.toLowerCase() === branchObj.name.toLowerCase() ||
            g.scope?.toLowerCase().includes(branchObj.name.toLowerCase()) ||
            g.name.toLowerCase().includes(branchObj.name.toLowerCase()));
        if (!matchesBranchId && !matchesBranchName) return false;
      }

      // Scope Team Filter
      if (selectedTeam !== "All") {
        const matchesTeamId = g.teamId === selectedTeam;
        const teamObj = db.teams.find((t) => t.id === selectedTeam);
        const matchesTeamName =
          teamObj &&
          (g.teamName?.toLowerCase() === teamObj.name.toLowerCase() ||
            g.scope?.toLowerCase().includes(teamObj.name.toLowerCase()) ||
            g.name.toLowerCase().includes(teamObj.name.toLowerCase()));
        if (!matchesTeamId && !matchesTeamName) return false;
      }

      // Category Filter
      if (selectedCategory !== "All") {
        if ((g.category || "General") !== selectedCategory) return false;
      }

      // Link Filter
      if (linkFilter === "WithLink" && !g.link?.trim()) return false;
      if (linkFilter === "MissingLink" && g.link?.trim()) return false;

      // Text Query Search
      if (search.trim()) {
        const q = search.toLowerCase();
        const inName = g.name.toLowerCase().includes(q);
        const inScope = g.scope?.toLowerCase().includes(q);
        const inBranch = g.branchName?.toLowerCase().includes(q);
        const inTeam = g.teamName?.toLowerCase().includes(q);
        const inLevel = g.coachLevel?.toLowerCase().includes(q);
        const inContact = g.contactName?.toLowerCase().includes(q);
        const inPhone = g.adminPhone?.toLowerCase().includes(q);
        const inLink = g.link?.toLowerCase().includes(q);
        if (
          !inName &&
          !inScope &&
          !inBranch &&
          !inTeam &&
          !inLevel &&
          !inContact &&
          !inPhone &&
          !inLink
        ) {
          return false;
        }
      }

      return true;
    });
  }, [
    scopedBaseGroups,
    db.branches,
    db.teams,
    selectedBranch,
    selectedTeam,
    selectedCategory,
    linkFilter,
    search,
  ]);

  // Statistics
  const stats = useMemo(() => {
    const all = scopedBaseGroups;
    const withLink = all.filter((g) => g.link && g.link.trim().length > 0);
    const branchCount = new Set(all.map((g) => g.branchId || g.branchName).filter(Boolean)).size;
    const teamCount = new Set(all.map((g) => g.teamId || g.teamName).filter(Boolean)).size;
    return {
      total: all.length,
      linked: withLink.length,
      percentLinked: all.length > 0 ? Math.round((withLink.length / all.length) * 100) : 0,
      branchesCovered: branchCount,
      teamsCovered: teamCount,
    };
  }, [scopedBaseGroups]);

  // Sync missing branches & teams
  const handleSyncMissing = () => {
    if (!canWrite) return;
    const now = new Date().toISOString();
    const existing = db.groups || [];
    const createdGroups: WhatsAppGroup[] = [];

    for (const b of scopedBranches) {
      const hasBranchGroup = existing.some(
        (g) => g.branchId === b.id || g.branchName?.toLowerCase() === b.name.toLowerCase(),
      );
      if (!hasBranchGroup) {
        createdGroups.push({
          id: `wg-${Date.now().toString(36)}-b-${Math.random().toString(36).substring(2, 6)}`,
          name: `${b.name} Branch Announcements`,
          scope: `${b.name} Branch`,
          scopeType: "branch",
          branchId: b.id,
          branchName: b.name,
          category: "General",
          contactName: b.manager || undefined,
          active: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    for (const t of scopedTeams) {
      const hasTeamGroup = existing.some(
        (g) => g.teamId === t.id || g.teamName?.toLowerCase() === t.name.toLowerCase(),
      );
      if (!hasTeamGroup) {
        const matchedB = db.branches.find(
          (br) => br.name.toLowerCase() === (t.branch || "").toLowerCase(),
        );
        createdGroups.push({
          id: `wg-${Date.now().toString(36)}-t-${Math.random().toString(36).substring(2, 6)}`,
          name: `${t.name} Broadcast Group`,
          scope: t.name,
          scopeType: "team",
          teamId: t.id,
          teamName: t.name,
          branchId: matchedB?.id,
          branchName: t.branch,
          category: "General",
          contactName: t.headCoach || undefined,
          active: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    if (createdGroups.length === 0) {
      toast.info("All branches and teams already have WhatsApp groups configured.");
      return;
    }

    update((d) => ({
      ...d,
      groups: [...createdGroups, ...(d.groups || [])],
    }));
    toast.success(`Synced ${createdGroups.length} missing branch & team WhatsApp group(s).`);
  };

  // Open Create Modal
  const handleOpenCreate = () => {
    if (!canWrite) return;
    setEditingGroup(null);
    const defaultBranchId =
      (isBranchScoped && assignedBranchObj ? assignedBranchObj.id : filterBranchId) ||
      scopedBranches[0]?.id ||
      "";
    const defaultBranch = scopedBranches.find((b) => b.id === defaultBranchId);
    const defaultTeamId = filterTeamId || scopedTeams[0]?.id || "";
    const defaultTeam = scopedTeams.find((t) => t.id === defaultTeamId);

    setManualName("");
    setManualPhone("");
    setManualRole("Parent / Guardian");

    setForm({
      name: defaultTeam ? `${defaultTeam.name} Matchday & Parents` : "New WhatsApp Group",
      scopeType: filterTeamId
        ? "team"
        : filterBranchId
          ? "branch"
          : defaultTeam
            ? "team"
            : "branch",
      branchId: defaultBranchId,
      teamId: defaultTeamId,
      coachLevel: coachLevels[0] || "All Coaches",
      customScope: "",
      link: "",
      category: "Games",
      adminPhone: "",
      contactName: defaultTeam?.headCoach || defaultBranch?.manager || "",
      description: "",
      active: true,
      manualMembers: [],
      excludedAutoPhones: [],
    });
    setModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (group: WhatsAppGroup) => {
    if (!canWrite) return;
    setEditingGroup(group);
    setManualName("");
    setManualPhone("");
    setManualRole("Parent / Guardian");

    let scopeType: WhatsAppGroupScopeType = group.scopeType || "custom";
    if (!group.scopeType) {
      if (group.coachLevel) {
        scopeType = "coach_level";
      } else if (
        group.teamId ||
        (group.teamName && db.teams.some((t) => t.name === group.teamName))
      ) {
        scopeType = "team";
      } else if (
        group.branchId ||
        (group.branchName && db.branches.some((b) => b.name === group.branchName))
      ) {
        scopeType = "branch";
      } else if (group.scope?.toLowerCase().includes("all academy")) {
        scopeType = "academy";
      }
    }

    setForm({
      name: group.name,
      scopeType,
      branchId:
        (isBranchScoped && assignedBranchObj ? assignedBranchObj.id : group.branchId) ||
        scopedBranches.find((b) => b.name === group.branchName)?.id ||
        scopedBranches[0]?.id ||
        "",
      teamId:
        group.teamId ||
        scopedTeams.find((t) => t.name === group.teamName)?.id ||
        scopedTeams[0]?.id ||
        "",
      coachLevel: group.coachLevel || coachLevels[0] || "All Coaches",
      customScope: group.scope || "",
      link: group.link || "",
      category: group.category || "General",
      adminPhone: group.adminPhone || "",
      contactName: group.contactName || "",
      description: group.description || "",
      active: group.active !== false,
      manualMembers: Array.isArray(group.manualMembers) ? group.manualMembers : [],
      excludedAutoPhones: Array.isArray(group.excludedAutoPhones) ? group.excludedAutoPhones : [],
    });
    setModalOpen(true);
  };

  const handleAddManualMemberInForm = () => {
    const cleanPhone = manualPhone.trim();
    if (!cleanPhone) {
      toast.error("Please enter a phone number to add.");
      return;
    }
    const cleanName = manualName.trim() || "Contact";
    const newEntry: WhatsAppGroupMemberPhone = {
      id: `mm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName,
      phone: cleanPhone,
      role: manualRole.trim() || "Manual Contact",
      isAuto: false,
    };
    setForm((prev) => ({
      ...prev,
      manualMembers: [...prev.manualMembers, newEntry],
    }));
    setManualName("");
    setManualPhone("");
    toast.success(`Added ${cleanName} (${cleanPhone}) to group.`);
  };

  const handleRemoveMemberInForm = (member: WhatsAppGroupMemberPhone) => {
    if (member.isAuto) {
      const digits = member.phone.replace(/[^\d+]/g, "");
      setForm((prev) => ({
        ...prev,
        excludedAutoPhones: Array.from(new Set([...prev.excludedAutoPhones, digits])),
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        manualMembers: prev.manualMembers.filter((m) => m.id !== member.id),
      }));
    }
  };

  const handleAddManualMemberDirectToGroup = (group: WhatsAppGroup) => {
    if (!canWrite) return;
    const cleanPhone = manualPhone.trim();
    if (!cleanPhone) {
      toast.error("Please enter a phone number.");
      return;
    }
    const cleanName = manualName.trim() || "Contact";
    const newEntry: WhatsAppGroupMemberPhone = {
      id: `mm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName,
      phone: cleanPhone,
      role: manualRole.trim() || "Manual Contact",
      isAuto: false,
    };
    const nextManual = [...(group.manualMembers || []), newEntry];
    update((d) => ({
      ...d,
      groups: (d.groups || []).map((g) =>
        g.id === group.id
          ? { ...g, manualMembers: nextManual, updatedAt: new Date().toISOString() }
          : g,
      ),
    }));
    setManualName("");
    setManualPhone("");
    toast.success(`Added ${cleanName} (${cleanPhone}) to "${group.name}".`);
  };

  const handleCopyGroupPhones = (group: WhatsAppGroup) => {
    const rawMembers = resolveWhatsAppGroupMembers(group, db);
    const members = Array.isArray(rawMembers) ? rawMembers : [];
    if (members.length === 0) {
      toast.info("No phone numbers in this group yet.");
      return;
    }
    const listStr = members.map((m) => m.phone).join(", ");
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(listStr);
      toast.success(`Copied ${members.length} phone number(s) to clipboard!`);
    }
  };

  // Save Add/Edit
  const handleSave = () => {
    if (!canWrite) return;
    if (!form.name.trim()) {
      toast.error("Please enter a group name.");
      return;
    }

    let calculatedScope = form.customScope;
    let branchId: string | undefined;
    let branchName: string | undefined;
    let teamId: string | undefined;
    let teamName: string | undefined;
    let coachLevel: string | undefined;

    if (form.scopeType === "branch") {
      const b = db.branches.find((br) => br.id === form.branchId);
      branchId = b?.id;
      branchName = b?.name;
      calculatedScope = b ? `${b.name} Branch` : "Branch";
    } else if (form.scopeType === "team") {
      const t = db.teams.find((tm) => tm.id === form.teamId);
      teamId = t?.id;
      teamName = t?.name;
      const matchedB = db.branches.find(
        (br) => br.name.toLowerCase() === (t?.branch || "").toLowerCase(),
      );
      branchId = matchedB?.id;
      branchName = t?.branch;
      calculatedScope = t ? `${t.name}` : "Team";
    } else if (form.scopeType === "coach_level") {
      coachLevel = form.coachLevel || "All Coaches";
      if (isBranchScoped && assignedBranchObj) {
        branchId = assignedBranchObj.id;
        branchName = assignedBranchObj.name;
      } else if (form.branchId) {
        const b = db.branches.find((br) => br.id === form.branchId);
        branchId = b?.id;
        branchName = b?.name;
      }
      calculatedScope = `Coaches · ${coachLevel}${branchName ? ` (${branchName})` : ""}`;
    } else if (form.scopeType === "academy") {
      calculatedScope = "All Academy";
    }

    if (form.link && !form.link.startsWith("http")) {
      toast.warning(
        "Link should start with http:// or https:// (e.g. https://chat.whatsapp.com/...)",
      );
    }

    const now = new Date().toISOString();
    const sanitizedManualMembers: WhatsAppGroupMemberPhone[] = (form.manualMembers || []).map(
      (m) => ({
        id: m.id,
        name: m.name,
        phone: m.phone,
        role: m.role,
        isAuto: false,
      }),
    );

    if (editingGroup) {
      const updatedGroup: WhatsAppGroup = {
        ...editingGroup,
        name: form.name.trim(),
        scope: calculatedScope || form.name.trim(),
        scopeType: form.scopeType,
        branchId,
        branchName,
        teamId,
        teamName,
        coachLevel,
        link: form.link.trim() || undefined,
        category: form.category,
        adminPhone: form.adminPhone.trim() || undefined,
        contactName: form.contactName.trim() || undefined,
        description: form.description.trim() || undefined,
        active: form.active,
        manualMembers: sanitizedManualMembers,
        excludedAutoPhones: form.excludedAutoPhones,
        updatedAt: now,
      };

      update((d) => ({
        ...d,
        groups: (d.groups || []).map((g) => (g.id === editingGroup.id ? updatedGroup : g)),
      }));

      toast.success(`Updated WhatsApp group "${updatedGroup.name}"`);
    } else {
      const newGroup: WhatsAppGroup = {
        id: `wg-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        name: form.name.trim(),
        scope: calculatedScope || form.name.trim(),
        scopeType: form.scopeType,
        branchId,
        branchName,
        teamId,
        teamName,
        coachLevel,
        link: form.link.trim() || undefined,
        category: form.category,
        adminPhone: form.adminPhone.trim() || undefined,
        contactName: form.contactName.trim() || undefined,
        description: form.description.trim() || undefined,
        active: form.active,
        manualMembers: sanitizedManualMembers,
        excludedAutoPhones: form.excludedAutoPhones,
        createdAt: now,
        updatedAt: now,
      };

      update((d) => ({
        ...d,
        groups: [newGroup, ...(d.groups || [])],
      }));

      toast.success(`Added new WhatsApp group "${newGroup.name}"`);
    }

    setModalOpen(false);
  };

  // Delete Action
  const confirmDelete = () => {
    if (!canDelete || !deletingGroup) return;
    update((d) => ({
      ...d,
      groups: (d.groups || []).filter((g) => g.id !== deletingGroup.id),
    }));
    toast.success(`Deleted WhatsApp group "${deletingGroup.name}"`);
    setDeletingGroup(null);
  };

  // Copy Link Handler
  const handleCopyLink = (group: WhatsAppGroup) => {
    if (!group.link) {
      toast.info("No invite link configured for this group yet.");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(group.link);
      setCopiedId(group.id);
      toast.success("WhatsApp invite link copied to clipboard!");
      setTimeout(() => setCopiedId(null), 2500);
    }
  };

  // Test / Open Link in WhatsApp
  const handleTestLink = (group: WhatsAppGroup) => {
    if (!group.link) {
      toast.error("No link to open. Click Edit to add a group invite link.");
      return;
    }
    window.open(group.link.trim(), "_blank", "noopener,noreferrer");
  };

  // Toggle Active
  const handleToggleActive = (group: WhatsAppGroup) => {
    if (!canWrite) return;
    const updatedStatus = !(group.active !== false);
    update((d) => ({
      ...d,
      groups: (d.groups || []).map((g) =>
        g.id === group.id
          ? { ...g, active: updatedStatus, updatedAt: new Date().toISOString() }
          : g,
      ),
    }));
    toast.info(`Group "${group.name}" is now ${updatedStatus ? "Active" : "Paused / Inactive"}.`);
  };

  return (
    <div className={embedded ? "space-y-4" : "space-y-6"}>
      {/* Top Banner & Summary KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-ink-400">
              Total Groups
            </span>
            <MessageSquare className="h-4 w-4 text-court-400" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-ink-100">{stats.total}</div>
          <div className="mt-1 text-xs text-ink-400 font-mono">Managed broadcast channels</div>
        </div>

        <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-ink-400">
              Active Links
            </span>
            <Link2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-emerald-400">{stats.linked}</span>
            <span className="text-xs font-mono text-ink-400">({stats.percentLinked}% linked)</span>
          </div>
          <div className="mt-1 text-xs text-ink-400 font-mono">1-click push enabled</div>
        </div>

        <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-ink-400">
              Branch Channels
            </span>
            <Building className="h-4 w-4 text-court-400" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-ink-100">
            {stats.branchesCovered}
          </div>
          <div className="mt-1 text-xs text-ink-400 font-mono">Mapped to academy branches</div>
        </div>

        <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-ink-400">
              Team Squads
            </span>
            <Trophy className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-ink-100">{stats.teamsCovered}</div>
          <div className="mt-1 text-xs text-ink-400 font-mono">Age group rosters & parents</div>
        </div>
      </div>

      {/* Main Panel */}
      <Panel
        title={title}
        meta="Manage invite links, match report channels, and pitch-side parent QR codes"
        action={
          canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncMissing}
                className="font-mono text-xs"
              >
                <span>Sync Missing Branches &amp; Teams</span>
              </Button>
              <Button
                variant="emerald"
                size="sm"
                onClick={handleOpenCreate}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
              >
                <Plus className="h-4 w-4" />
                <span>Add WhatsApp Group</span>
              </Button>
            </div>
          ) : undefined
        }
      >
        <div className="space-y-4 p-4">
          {/* Search & Filters Controls */}
          <div
            className={`flex flex-col gap-3 rounded-lg border border-ink-800 bg-ink-950 p-3 ${
              embedded ? "" : "xl:flex-row xl:items-center xl:justify-between"
            }`}
          >
            {/* Search Input */}
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                type="text"
                placeholder="Search groups by name, branch, team, or link..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md bg-ink-900 py-1.5 pl-9 pr-3 font-mono text-xs text-ink-100 placeholder:text-ink-500 ring-1 ring-ink-750 focus:outline-none focus:ring-1 focus:ring-court-500"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Filter Dropdowns */}
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              {/* Branch Filter */}
              <select
                value={selectedBranch}
                disabled={isBranchScoped}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="rounded-md bg-ink-900 px-2.5 py-1.5 text-xs text-ink-200 ring-1 ring-ink-750 focus:outline-none focus:ring-1 focus:ring-court-500 disabled:opacity-60"
              >
                {!isBranchScoped && <option value="All">All Branches</option>}
                {scopedBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>

              {/* Team Filter */}
              <select
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                className="rounded-md bg-ink-900 px-2.5 py-1.5 text-xs text-ink-200 ring-1 ring-ink-750 focus:outline-none focus:ring-1 focus:ring-court-500"
              >
                <option value="All">All Teams</option>
                {scopedTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              {/* Category Filter */}
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="rounded-md bg-ink-900 px-2.5 py-1.5 text-xs text-ink-200 ring-1 ring-ink-750 focus:outline-none focus:ring-1 focus:ring-court-500"
              >
                <option value="All">All Categories</option>
                <option value="Games">🏆 Games & Results</option>
                <option value="Sessions">🏀 Training & Sessions</option>
                <option value="Parents">👨‍👩‍👧 Parents & Community</option>
                <option value="Coaches">📋 Coaches & Staff</option>
                <option value="General">📢 General Broadcast</option>
                <option value="Emergency">🚨 Emergency Alerts</option>
              </select>

              {/* Link Status Filter */}
              <select
                value={linkFilter}
                onChange={(e) =>
                  setLinkFilter(e.target.value as "All" | "WithLink" | "MissingLink")
                }
                className="rounded-md bg-ink-900 px-2.5 py-1.5 text-xs text-ink-200 ring-1 ring-ink-750 focus:outline-none focus:ring-1 focus:ring-court-500"
              >
                <option value="All">All Statuses</option>
                <option value="WithLink">✓ With Invite Link</option>
                <option value="MissingLink">⚠️ Missing Link</option>
              </select>

              {(search ||
                selectedBranch !== "All" ||
                selectedTeam !== "All" ||
                selectedCategory !== "All" ||
                linkFilter !== "All") && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setSelectedBranch("All");
                    setSelectedTeam("All");
                    setSelectedCategory("All");
                    setLinkFilter("All");
                  }}
                  className="rounded-md bg-ink-800 px-2.5 py-1.5 text-court-400 hover:bg-ink-750 ring-1 ring-ink-700"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Groups Listing */}
          {filteredGroups.length === 0 ? (
            <div className="py-12">
              <EmptyState>
                {search ||
                selectedBranch !== "All" ||
                selectedTeam !== "All" ||
                selectedCategory !== "All"
                  ? "No WhatsApp groups match the active filters."
                  : "No WhatsApp groups configured yet. Click '+ Add WhatsApp Group' above to set up channels for your branches and teams."}
              </EmptyState>
            </div>
          ) : (
            <div
              className={
                embedded
                  ? filteredGroups.length === 1
                    ? "grid gap-4 grid-cols-1"
                    : "grid gap-4 grid-cols-1 md:grid-cols-2"
                  : filteredGroups.length === 1
                    ? "grid gap-4 grid-cols-1 lg:grid-cols-2"
                    : "grid gap-4 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3"
              }
            >
              {filteredGroups.map((group) => {
                const cat = group.category || "General";
                const catMeta = CATEGORY_CONFIG[cat] || CATEGORY_CONFIG.General;
                const isActive = group.active !== false;
                const rawGroupMembers = resolveWhatsAppGroupMembers(group, db);
                const groupMembers = Array.isArray(rawGroupMembers) ? rawGroupMembers : [];
                const autoMembersCount = groupMembers.filter((m) => m.isAuto).length;
                const manualMembersCount = groupMembers.filter((m) => !m.isAuto).length;
                const isExpanded = expandedRosterGroupId === group.id;

                return (
                  <div
                    key={group.id}
                    className={`flex flex-col justify-between rounded-xl border p-4 transition-all min-w-0 overflow-hidden ${
                      isActive
                        ? "border-ink-800 bg-ink-900/90 hover:border-court-500/40"
                        : "border-ink-850 bg-ink-950/60 opacity-70"
                    }`}
                  >
                    <div className="min-w-0">
                      {/* Top Row: Category & Status */}
                      <div className="flex items-start justify-between gap-2 mb-2.5">
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                          <Chip tone={catMeta.tone}>
                            <span>{catMeta.icon}</span>
                            <span className="ml-1 uppercase text-[10px] tracking-wide">
                              {catMeta.label}
                            </span>
                          </Chip>
                          {group.branchName && (
                            <span className="flex items-center gap-1 rounded bg-ink-800 px-2 py-0.5 font-mono text-[10px] text-court-300 ring-1 ring-ink-700">
                              <Building className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{group.branchName}</span>
                            </span>
                          )}
                          {group.teamName && (
                            <span className="flex items-center gap-1 rounded bg-ink-800 px-2 py-0.5 font-mono text-[10px] text-amber-300 ring-1 ring-ink-700">
                              <Trophy className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{group.teamName}</span>
                            </span>
                          )}
                          {group.coachLevel && (
                            <span className="flex items-center gap-1 rounded bg-ink-800 px-2 py-0.5 font-mono text-[10px] text-emerald-300 ring-1 ring-ink-700">
                              <GraduationCap className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{group.coachLevel}</span>
                            </span>
                          )}
                        </div>

                        {/* Status Toggle */}
                        {canWrite ? (
                          <button
                            type="button"
                            onClick={() => handleToggleActive(group)}
                            className={`shrink-0 rounded px-2 py-0.5 font-mono text-[9px] uppercase font-bold transition-colors ${
                              isActive
                                ? "bg-good/15 text-good hover:bg-good/25"
                                : "bg-ink-800 text-ink-400 hover:bg-ink-750"
                            }`}
                            title={isActive ? "Click to pause group" : "Click to activate group"}
                          >
                            {isActive ? "ACTIVE" : "PAUSED"}
                          </button>
                        ) : (
                          <span
                            className={`shrink-0 rounded px-2 py-0.5 font-mono text-[9px] uppercase font-bold ${
                              isActive ? "bg-good/15 text-good" : "bg-ink-800 text-ink-400"
                            }`}
                          >
                            {isActive ? "ACTIVE" : "PAUSED"}
                          </span>
                        )}
                      </div>

                      {/* Group Title */}
                      <h4 className="text-sm font-bold text-ink-100 leading-snug break-words">
                        {group.name}
                      </h4>

                      {/* Scope & Description */}
                      <p className="mt-1 text-xs text-ink-400 font-mono">
                        Assigned to:{" "}
                        <span className="text-ink-200">{group.scope || "Academy Wide"}</span>
                      </p>

                      {group.description && (
                        <p className="mt-2 text-xs text-ink-300 leading-relaxed bg-ink-950/70 p-2 rounded border border-ink-800">
                          {group.description}
                        </p>
                      )}

                      {/* Contact / Phone row */}
                      {(group.contactName || group.adminPhone) && (
                        <div className="mt-3 flex items-center gap-2 text-xs font-mono text-ink-400">
                          <Phone className="h-3 w-3 text-court-400 shrink-0" />
                          <span className="truncate">
                            {group.contactName || "Admin"}:{" "}
                            {group.adminPhone ? (
                              <a
                                href={`https://wa.me/${formatWhatsAppPhone(group.adminPhone)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-emerald-400 hover:underline"
                              >
                                {group.adminPhone}
                              </a>
                            ) : (
                              "No phone listed"
                            )}
                          </span>
                        </div>
                      )}

                      {/* Phone Numbers Roster Summary & Expandable Panel */}
                      <div className="mt-3 rounded-lg border border-ink-800 bg-ink-950/80 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setExpandedRosterGroupId(isExpanded ? null : group.id)}
                            className="flex items-center gap-1.5 text-left font-mono text-[11px] text-court-300 hover:text-court-200 min-w-0"
                          >
                            <Users className="h-3.5 w-3.5 text-court-400 shrink-0" />
                            <span className="leading-snug">
                              <strong className="text-ink-100">{groupMembers.length}</strong> Phone
                              Numbers{" "}
                              <span className="text-ink-400">
                                ({autoMembersCount} Auto · {manualMembersCount} Manual)
                              </span>
                            </span>
                          </button>
                          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                            {groupMembers.length > 0 && (
                              <button
                                type="button"
                                onClick={() => handleCopyGroupPhones(group)}
                                className="rounded bg-ink-850 px-2.5 py-1 font-mono text-[10px] text-ink-200 ring-1 ring-ink-700 hover:text-court-300 transition-colors whitespace-nowrap"
                                title="Copy all phone numbers in this group"
                              >
                                Copy Phones
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setExpandedRosterGroupId(isExpanded ? null : group.id)}
                              className="rounded bg-court-500/15 px-2.5 py-1 font-mono text-[10px] font-semibold text-court-300 ring-1 ring-court-500/30 hover:bg-court-500/25 transition-colors whitespace-nowrap"
                            >
                              {isExpanded ? "Hide" : canWrite ? "+ Numbers" : "View"}
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="mt-2.5 border-t border-ink-800 pt-2.5 space-y-2">
                            {groupMembers.length === 0 ? (
                              <div className="text-[11px] font-mono text-ink-500 py-1">
                                No phone numbers listed yet. Assign a team or coach level, or add
                                numbers manually below.
                              </div>
                            ) : (
                              <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                                {groupMembers.map((m) => (
                                  <div
                                    key={m.id}
                                    className="flex items-center justify-between gap-2 rounded bg-ink-900 px-2 py-1 text-[11px] font-mono border border-ink-850"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="text-ink-100 font-semibold truncate">
                                          {m.name}
                                        </span>
                                        <span
                                          className={`rounded px-1 py-0.2 text-[9px] uppercase ${
                                            m.isAuto
                                              ? "bg-court-500/15 text-court-300"
                                              : "bg-emerald-500/15 text-emerald-300"
                                          }`}
                                        >
                                          {m.isAuto ? `AUTO · ${m.role}` : m.role}
                                        </span>
                                      </div>
                                      <div className="text-ink-400 text-[10px]">{m.phone}</div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openDirectWhatsApp(
                                            m.phone,
                                            `Hello ${m.name}, message from ${group.name}.`,
                                          )
                                        }
                                        className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400 hover:bg-emerald-500/25"
                                        title={`Message ${m.name} on WhatsApp`}
                                      >
                                        WA
                                      </button>
                                      {canWrite && !m.isAuto && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const nextManual = (group.manualMembers || []).filter(
                                              (x) => x.id !== m.id,
                                            );
                                            update((d) => ({
                                              ...d,
                                              groups: (d.groups || []).map((g) =>
                                                g.id === group.id
                                                  ? { ...g, manualMembers: nextManual }
                                                  : g,
                                              ),
                                            }));
                                          }}
                                          className="rounded p-0.5 text-ink-500 hover:text-bad"
                                          title="Remove manual number"
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {canWrite && (
                              <div className="pt-1.5 border-t border-ink-850 space-y-1.5">
                                <div className="text-[10px] font-mono uppercase text-ink-400">
                                  Add Extra Phone Number Manually
                                </div>
                                <div className="grid grid-cols-2 gap-1.5">
                                  <input
                                    type="text"
                                    placeholder="Contact Name"
                                    value={manualName}
                                    onChange={(e) => setManualName(e.target.value)}
                                    className="rounded bg-ink-900 px-2 py-1 text-xs font-mono text-ink-100 ring-1 ring-ink-750"
                                  />
                                  <input
                                    type="text"
                                    placeholder="+961 70 123456"
                                    value={manualPhone}
                                    onChange={(e) => setManualPhone(e.target.value)}
                                    className="rounded bg-ink-900 px-2 py-1 text-xs font-mono text-ink-100 ring-1 ring-ink-750"
                                  />
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    placeholder="Role (e.g. Guardian, Driver)"
                                    value={manualRole}
                                    onChange={(e) => setManualRole(e.target.value)}
                                    className="flex-1 rounded bg-ink-900 px-2 py-1 text-xs font-mono text-ink-100 ring-1 ring-ink-750"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleAddManualMemberDirectToGroup(group)}
                                    className="inline-flex items-center gap-1 rounded bg-court-500 px-2.5 py-1 font-mono text-[10px] font-bold text-ink-950 hover:bg-court-400"
                                  >
                                    <UserPlus className="h-3 w-3" />
                                    <span>Add</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bottom Link Box & Controls */}
                    <div className="mt-4 pt-3 border-t border-ink-800/80 space-y-2.5">
                      {/* Invite Link status */}
                      <div className="flex items-center justify-between gap-2 text-xs font-mono">
                        {group.link ? (
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                            <a
                              href={group.link}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-400 hover:underline truncate text-[11px]"
                              title={group.link}
                            >
                              {group.link}
                            </a>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-[11px] text-warn">
                            <AlertCircle className="h-3.5 w-3.5" />
                            <span>No invite link set</span>
                          </div>
                        )}

                        {group.link && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleCopyLink(group)}
                              className="rounded p-1 text-ink-400 hover:text-ink-100 hover:bg-ink-800 transition-colors"
                              title="Copy invite link"
                            >
                              {copiedId === group.id ? (
                                <Check className="h-3.5 w-3.5 text-good" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => setQrModalGroup(group)}
                              className="rounded p-1 text-court-400 hover:text-court-300 hover:bg-court-500/10 transition-colors"
                              title="Pitch-side QR Code for parents"
                            >
                              <QrCode className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons Row */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-ink-800/60 mt-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {canWrite && (
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => handleOpenEdit(group)}
                              className="font-mono text-xs"
                            >
                              <Edit2 className="h-3 w-3 mr-1" />
                              <span>Edit &amp; Numbers</span>
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => setDeletingGroup(group)}
                              className="font-mono text-xs text-ink-400 hover:text-bad hover:bg-bad/10 px-2"
                              title="Delete WhatsApp Group"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>

                        {group.link ? (
                          <Button
                            variant="emerald"
                            size="xs"
                            onClick={() => handleTestLink(group)}
                            className="font-mono text-xs font-semibold ml-auto"
                          >
                            <span>Open</span>
                            <ExternalLink className="h-3 w-3 ml-1" />
                          </Button>
                        ) : canWrite ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => handleOpenEdit(group)}
                            className="text-xs font-mono text-court-400 hover:underline ml-auto"
                          >
                            + Add Link
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Panel>

      {/* MODAL: Add / Edit WhatsApp Group */}
      <Modal
        open={modalOpen}
        title={editingGroup ? `Edit WhatsApp Group: ${editingGroup.name}` : "Set Up WhatsApp Group"}
        meta="Assign group to a Team, Level of Coaches, or Branch — auto-lists player & guardian numbers while allowing manual additions"
        onClose={() => setModalOpen(false)}
        onSubmit={handleSave}
        submitLabel={editingGroup ? "Save Changes" : "Create Group"}
        wide
      >
        <div className="p-4 space-y-4">
          {/* Scope Type Selector */}
          <div>
            <label className="block font-mono text-xs text-ink-300 mb-1.5">
              Assign Group To (Target Scope):
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, scopeType: "team" })}
                className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-mono transition-all ${
                  form.scopeType === "team"
                    ? "border-court-500 bg-court-500/15 text-court-300 font-bold"
                    : "border-ink-800 bg-ink-900 text-ink-400 hover:border-ink-700"
                }`}
              >
                <Trophy className="h-3.5 w-3.5" />
                <span>Team / Squad</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setForm({
                    ...form,
                    scopeType: "coach_level",
                    category: "Coaches",
                    name:
                      form.name === "New WhatsApp Group"
                        ? `${form.coachLevel || "All Coaches"} Group`
                        : form.name,
                  })
                }
                className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-mono transition-all ${
                  form.scopeType === "coach_level"
                    ? "border-court-500 bg-court-500/15 text-court-300 font-bold"
                    : "border-ink-800 bg-ink-900 text-ink-400 hover:border-ink-700"
                }`}
              >
                <GraduationCap className="h-3.5 w-3.5" />
                <span>Coach Level</span>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, scopeType: "branch" })}
                className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-mono transition-all ${
                  form.scopeType === "branch"
                    ? "border-court-500 bg-court-500/15 text-court-300 font-bold"
                    : "border-ink-800 bg-ink-900 text-ink-400 hover:border-ink-700"
                }`}
              >
                <Building className="h-3.5 w-3.5" />
                <span>Branch</span>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, scopeType: "academy" })}
                className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-mono transition-all ${
                  form.scopeType === "academy"
                    ? "border-court-500 bg-court-500/15 text-court-300 font-bold"
                    : "border-ink-800 bg-ink-900 text-ink-400 hover:border-ink-700"
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                <span>All Academy</span>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, scopeType: "custom" })}
                className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-mono transition-all ${
                  form.scopeType === "custom"
                    ? "border-court-500 bg-court-500/15 text-court-300 font-bold"
                    : "border-ink-800 bg-ink-900 text-ink-400 hover:border-ink-700"
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Custom</span>
              </button>
            </div>
          </div>

          {/* Conditional Selectors for Team, Coach Level, Branch, Custom */}
          {form.scopeType === "team" && (
            <Field
              label="Select Team / Squad"
              hint="Automatically lists all team players' phones and their guardians' phone numbers"
            >
              <select
                value={form.teamId}
                onChange={(e) => {
                  const tId = e.target.value;
                  const t = scopedTeams.find((tm) => tm.id === tId);
                  setForm({
                    ...form,
                    teamId: tId,
                    name: t ? `${t.name} Matchday & Parents` : form.name,
                    contactName: t?.headCoach || form.contactName,
                  });
                }}
                className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500"
              >
                {scopedTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.category} {t.gender}) — Coach: {t.headCoach}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {form.scopeType === "coach_level" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Select Level of Coaches"
                hint="Automatically lists phone numbers of coaches at this level"
              >
                <select
                  value={form.coachLevel}
                  onChange={(e) => {
                    const lvl = e.target.value;
                    setForm({
                      ...form,
                      coachLevel: lvl,
                      name: `${lvl} WhatsApp Group`,
                    });
                  }}
                  className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500"
                >
                  {coachLevels.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Branch Filter (Optional)" hint="Scope coaches to a branch or all">
                <select
                  value={form.branchId}
                  disabled={isBranchScoped}
                  onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                  className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500 disabled:opacity-60"
                >
                  {!isBranchScoped && <option value="">All Branches</option>}
                  {scopedBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {form.scopeType === "branch" && (
            <Field label="Select Academy Branch" hint="Assign this group specifically to a branch">
              <select
                value={form.branchId}
                disabled={isBranchScoped}
                onChange={(e) => {
                  const bId = e.target.value;
                  const b = scopedBranches.find((br) => br.id === bId);
                  setForm({
                    ...form,
                    branchId: bId,
                    contactName: b?.manager || form.contactName,
                  });
                }}
                className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500 disabled:opacity-60"
              >
                {scopedBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.city}) — Manager: {b.manager}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {form.scopeType === "custom" && (
            <Field label="Custom Target Scope" hint="e.g. U-14 & U-16 Staff, Tournament Committee">
              <Input
                value={form.customScope}
                onChange={(v) => setForm({ ...form, customScope: v })}
                placeholder="e.g. North Division Parents"
              />
            </Field>
          )}

          {/* Group Name & Category */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Group Title / Display Name"
              hint="e.g. U-14 Boys Elite Matchday & Parents"
            >
              <Input
                value={form.name}
                onChange={(v) => setForm({ ...form, name: v })}
                placeholder="e.g. Achrafieh Parents Broadcast"
              />
            </Field>

            <Field label="Group Category / Purpose">
              <select
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value as WhatsAppGroupCategory })
                }
                className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500"
              >
                <option value="Games">🏆 Games & Match Reports</option>
                <option value="Sessions">🏀 Training & Practice Sessions</option>
                <option value="Parents">👨‍👩‍👧 Parents & Guardians Broadcast</option>
                <option value="Coaches">📋 Coaches & Staff</option>
                <option value="General">📢 General Announcements</option>
                <option value="Emergency">🚨 Urgent & Weather Alerts</option>
              </select>
            </Field>
          </div>

          {/* Group Phone Numbers Section (Auto-Listed + Manual Additions) */}
          <div className="rounded-lg border border-court-500/30 bg-ink-950 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-mono text-xs font-bold text-court-300 flex items-center gap-1.5">
                  <Users className="h-4 w-4" />
                  <span>
                    Group Phone Numbers ({modalPreviewMembers.length} Total:{" "}
                    {modalPreviewMembers.filter((m) => m.isAuto).length} Auto-Listed ·{" "}
                    {modalPreviewMembers.filter((m) => !m.isAuto).length} Manual)
                  </span>
                </div>
                <p className="text-[11px] font-mono text-ink-400 mt-0.5">
                  {form.scopeType === "team"
                    ? "Player phone numbers and their guardians (Guardian 1 & Guardian 2) are automatically listed below. You can also add extra numbers manually."
                    : form.scopeType === "coach_level"
                      ? `Coaches matching "${form.coachLevel}" are automatically listed below. You can also add extra numbers manually.`
                      : "Add phone numbers manually or switch scope to a Team / Coach Level to auto-populate numbers."}
                </p>
              </div>
              {form.excludedAutoPhones.length > 0 && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, excludedAutoPhones: [] })}
                  className="rounded bg-ink-850 px-2 py-1 font-mono text-[10px] text-court-400 ring-1 ring-ink-700 hover:text-court-300"
                >
                  Restore {form.excludedAutoPhones.length} Excluded Auto Number(s)
                </button>
              )}
            </div>

            {/* Add Manual Phone Number Row */}
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] items-end bg-ink-900/80 p-2.5 rounded-md border border-ink-800">
              <div>
                <label className="block font-mono text-[10px] uppercase text-ink-400 mb-1">
                  Contact Name
                </label>
                <Input
                  value={manualName}
                  onChange={setManualName}
                  placeholder="e.g. Uncle / Driver / Coach"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] uppercase text-ink-400 mb-1">
                  Phone Number
                </label>
                <Input value={manualPhone} onChange={setManualPhone} placeholder="+961 70 123456" />
              </div>
              <div>
                <label className="block font-mono text-[10px] uppercase text-ink-400 mb-1">
                  Role / Label
                </label>
                <Input
                  value={manualRole}
                  onChange={setManualRole}
                  placeholder="Parent / Guardian / Staff"
                />
              </div>
              <button
                type="button"
                onClick={handleAddManualMemberInForm}
                className="flex items-center justify-center gap-1.5 rounded-md bg-court-500 hover:bg-court-400 px-3 py-2 font-mono text-xs font-bold text-ink-950 transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>+ Add Number</span>
              </button>
            </div>

            {/* Member List */}
            {modalPreviewMembers.length === 0 ? (
              <div className="py-4 text-center font-mono text-xs text-ink-500">
                No phone numbers found for this selection yet. Use "+ Add Number" above to add
                numbers manually.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {modalPreviewMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-ink-900 px-3 py-1.5 border border-ink-800 text-xs font-mono"
                  >
                    <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink-100">{member.name}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                          member.isAuto
                            ? "bg-court-500/15 text-court-300 ring-1 ring-court-500/30"
                            : "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                        }`}
                      >
                        {member.isAuto ? `AUTO · ${member.role}` : `MANUAL · ${member.role}`}
                      </span>
                      <span className="text-ink-300">{member.phone}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveMemberInForm(member)}
                      className="rounded p-1 text-ink-400 hover:text-bad hover:bg-bad/10 transition-colors"
                      title={
                        member.isAuto
                          ? "Exclude this auto-listed number from group"
                          : "Remove manual number"
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* WhatsApp Invite Link with Validation & Test Button */}
          <div className="space-y-1.5 rounded-lg border border-ink-750 bg-ink-950 p-3.5">
            <div className="flex items-center justify-between">
              <label className="block font-mono text-xs text-ink-200 font-semibold">
                WhatsApp Group Invite Link
              </label>
              {form.link && form.link.startsWith("https://chat.whatsapp.com/") && (
                <span className="flex items-center gap-1 font-mono text-[10px] text-good">
                  <CheckCircle2 className="h-3 w-3" /> Valid WhatsApp Invite Format
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={form.link}
                onChange={(v) => setForm({ ...form, link: v })}
                placeholder="https://chat.whatsapp.com/AbCdEfGhIjK12345"
              />
              {form.link && (
                <button
                  type="button"
                  onClick={() => window.open(form.link.trim(), "_blank", "noopener,noreferrer")}
                  className="shrink-0 flex items-center gap-1 rounded bg-ink-800 px-3 py-2 text-xs font-mono text-court-300 hover:bg-ink-750 border border-ink-700"
                  title="Test link in new tab"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Test</span>
                </button>
              )}
            </div>
            <p className="text-[11px] font-mono text-ink-400">
              Obtained from WhatsApp Group Info → Invite via link → Copy link. Allows 1-click
              pushing of game reports & pitch-side QR joining.
            </p>
          </div>

          {/* Admin & Moderator Contacts */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Admin / Coach Contact Person" hint="Designated channel moderator">
              <Input
                value={form.contactName}
                onChange={(v) => setForm({ ...form, contactName: v })}
                placeholder="e.g. Coach Ziad or Branch Manager"
              />
            </Field>

            <Field
              label="Admin WhatsApp Phone Number"
              hint="International format with country code"
            >
              <Input
                value={form.adminPhone}
                onChange={(v) => setForm({ ...form, adminPhone: v })}
                placeholder="e.g. +961 70 123456"
              />
            </Field>
          </div>

          {/* Channel Description / Rules */}
          <Field
            label="Channel Guidelines / Description (Optional)"
            hint="Rules for coaches, athletes, or parents in this group"
          >
            <Textarea
              value={form.description}
              onChange={(v) => setForm({ ...form, description: v })}
              rows={2}
              placeholder="e.g. Official squad announcements only. No commercial ads or spam."
            />
          </Field>

          {/* Active Switch */}
          <div className="flex items-center justify-between border-t border-ink-800 pt-3">
            <div>
              <div className="text-xs font-medium text-ink-200">Channel Active Status</div>
              <div className="text-[11px] font-mono text-ink-400">
                Inactive channels are hidden from the matchday 1-click push dropdown
              </div>
            </div>
            <button
              type="button"
              onClick={() => setForm({ ...form, active: !form.active })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                form.active ? "bg-court-500" : "bg-ink-700"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  form.active ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Delete Confirmation */}
      <Modal
        open={!!deletingGroup}
        title="Delete WhatsApp Group Link?"
        meta="This action will remove the link from the academy directory"
        onClose={() => setDeletingGroup(null)}
      >
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-bad/30 bg-bad/10 p-3.5 text-xs text-bad">
            <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold">Permanent Channel Removal</div>
              <p className="leading-relaxed">
                Are you sure you want to delete{" "}
                <span className="font-bold text-ink-100">"{deletingGroup?.name}"</span>? Coaches
                will no longer be able to push game reports or session notices to this group with 1
                click.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" size="md" onClick={() => setDeletingGroup(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="md" onClick={confirmDelete}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete Group
            </Button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Pitch-side QR Code for Parents & Athletes */}
      <Modal
        open={!!qrModalGroup}
        title="Pitch-Side WhatsApp Group QR Code"
        meta={qrModalGroup ? qrModalGroup.name : ""}
        onClose={() => setQrModalGroup(null)}
      >
        {qrModalGroup && qrModalGroup.link && (
          <div className="p-6 flex flex-col items-center text-center space-y-4">
            <div className="rounded-2xl border-4 border-court-500/40 bg-white p-4 shadow-xl">
              <QRCodeSVG value={qrModalGroup.link} size={220} level="H" includeMargin={true} />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-bold text-ink-100">{qrModalGroup.name}</h3>
              <p className="font-mono text-xs text-ink-400">
                Scope: {qrModalGroup.scope || "Academy Wide"}
              </p>
              <p className="text-xs text-ink-300 max-w-sm pt-1">
                Point any smartphone camera at this QR code to join this WhatsApp group directly.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 pt-2 w-full">
              <button
                type="button"
                onClick={() => {
                  if (typeof navigator !== "undefined" && navigator.clipboard) {
                    navigator.clipboard.writeText(qrModalGroup.link || "");
                    setCopiedQr(true);
                    toast.success("Group invite link copied to clipboard!");
                    setTimeout(() => setCopiedQr(false), 2000);
                  }
                }}
                className="flex items-center gap-1.5 rounded-lg bg-ink-800 hover:bg-ink-750 px-3.5 py-2 text-xs font-mono text-ink-200 border border-ink-700 transition-colors"
              >
                {copiedQr ? (
                  <Check className="h-3.5 w-3.5 text-good" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copiedQr ? "Copied Link!" : "Copy Invite Link"}</span>
              </button>

              <button
                type="button"
                onClick={() => window.open(qrModalGroup.link, "_blank", "noopener,noreferrer")}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-mono font-bold text-white shadow transition-all active:scale-95"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open in WhatsApp</span>
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default WhatsAppGroupsManager;

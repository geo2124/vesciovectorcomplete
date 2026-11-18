import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  Button,
  Chip,
  EmptyState,
  Field,
  FilterSelect,
  Input,
  Modal,
  Panel,
  Row,
  RowActions,
  Search,
  Select,
  Stat,
  Table,
  Td,
  Th,
  money,
} from "@/components/kit";
import { useDB, useTenantUser, defaultRoleDefinitions } from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import type { Staff, LedgerEntry } from "@/lib/mock-data";
import { uploadStaffDocument } from "@/lib/storage";
import { toast } from "sonner";
import { Download, FileSpreadsheet, FileText } from "lucide-react";

export const Route = createFileRoute("/personnel")({
  head: () => ({
    meta: [
      { title: "Personnel — Vescio Vector" },
      {
        name: "description",
        content:
          "Academy staff directory: managers, technical directors, accountants and branch personnel with documents.",
      },
      { property: "og:title", content: "Personnel — Vescio Vector" },
      {
        property: "og:description",
        content: "Manage academy staff, positions, contacts and documents.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PersonnelPage,
});

const DEFAULT_POSITIONS = [
  "General Manager",
  "Technical Director",
  "Branch Manager",
  "Accountant",
  "Physiotherapist",
  "Administrator",
];

const blank: Omit<Staff, "id"> = {
  name: "",
  position: "Administrator",
  phone: "",
  email: "",
  branch: "HQ",
  branches: ["HQ"],
  dob: "",
  idFile: "",
  salary: 0,
  salaryType: "Monthly",
  payments: [],
};

function PersonnelPage() {
  const {
    db,
    setEntity,
    deleteEntity,
    editLedgerTransaction,
    deleteLedgerTransaction,
    tenantId,
    ready,
  } = useDB();
  const currency = db.academy?.currency || "USD";
  const currentUser = useTenantUser();
  const { user, passwordUser, loading: authLoading } = useAuth();
  const rawRoles =
    db.customRoles && db.customRoles.length > 0 ? db.customRoles : defaultRoleDefinitions;
  const userRoleDef = rawRoles.find((r) => r.name === currentUser?.role);
  const roleLower = (currentUser?.role || "").toLowerCase();

  // Page level guard: user must have staff read permission
  const hasStaffAccess =
    Boolean(currentUser) &&
    (currentUser?.role === "Super Admin" ||
      currentUser?.role === "Academy Manager" ||
      userRoleDef?.permissions?.["staff"]?.read !== false);

  // Confidential guard: strictly requires Super Admin, Academy Manager, or Accountant role to view salaries and passport/ID uploads
  const canViewConfidential =
    Boolean(currentUser) &&
    (currentUser?.role === "Super Admin" ||
      currentUser?.role === "Academy Manager" ||
      currentUser?.role === "Accountant" ||
      roleLower.includes("super") ||
      roleLower.includes("accountant"));

  // Staff management guard: requires Super Admin, Academy Manager, Administrator, HR Manager, or explicit staff write permission
  const canManageStaff =
    Boolean(currentUser) &&
    (currentUser?.role === "Super Admin" ||
      currentUser?.role === "Academy Manager" ||
      currentUser?.role === "Administrator" ||
      currentUser?.role === "HR Manager" ||
      userRoleDef?.permissions?.["staff"]?.write === true);

  const staff = db.staff;
  const positions = db.lists?.["Staff positions"]?.length
    ? db.lists["Staff positions"]
    : DEFAULT_POSITIONS;
  const branches = ["HQ", ...db.branches.map((b) => b.name)];

  const [q, setQ] = useState("");
  const [pos, setPos] = useState("");
  const [branch, setBranch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [form, setForm] = useState<Omit<Staff, "id"> & { id?: string }>(blank);
  const [pendingLedgerEntries, setPendingLedgerEntries] = useState<LedgerEntry[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [modalTab, setModalTab] = useState<"Profile" | "Payroll">("Profile");
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportPos, setExportPos] = useState("All positions");
  const [exportBranch, setExportBranch] = useState("All branches");
  const [newPayment, setNewPayment] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: 0,
    notes: "",
  });
  const [historyStaffId, setHistoryStaffId] = useState<string | null>(null);
  const historyStaff = staff.find((s) => s.id === historyStaffId) || null;
  const [editingStaffPayment, setEditingStaffPayment] = useState<{
    staffId: string;
    paymentId?: string;
    ledgerId?: string;
    date: string;
    amount: number;
    notes: string;
  } | null>(null);

  const exportStaffMatches = staff.filter((s) => {
    const matchPos = !exportPos || exportPos === "All positions" || s.position === exportPos;
    const matchBranch =
      !exportBranch || exportBranch === "All branches" || s.branch === exportBranch;
    return matchPos && matchBranch;
  });

  function handleExportCSV() {
    const academyName = db.academy?.name || "Vescio Vector";
    const headers = canViewConfidential
      ? [
          "Name,Position,Branch,Email,Phone,Date of Birth,Salary Type,Salary Amount,ID Document on File",
        ]
      : ["Name,Position,Branch,Email,Phone,Date of Birth"];

    const rows = exportStaffMatches.map((s) => {
      if (canViewConfidential) {
        return `"${s.name.replace(/"/g, '""')}","${s.position}","${s.branch}","${s.email}","${s.phone}","${s.dob || ""}","${s.salaryType || "Monthly"}",${s.salary || 0},"${s.idFile ? "Yes" : "No"}"`;
      }
      return `"${s.name.replace(/"/g, '""')}","${s.position}","${s.branch}","${s.email}","${s.phone}","${s.dob || ""}"`;
    });

    const csv = headers.concat(rows).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const posTag = exportPos.replace(/\s+/g, "_");
    const branchTag = exportBranch.replace(/\s+/g, "_");
    a.download = `${academyName.replace(/\s+/g, "_")}_Staff_${posTag}_${branchTag}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Staff directory (CSV) downloaded successfully.");
    setExportModalOpen(false);
  }

  async function handleExportPDF() {
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const academyName = db.academy?.name || "Vescio Vector";

      // Header Banner
      doc.setFillColor(15, 23, 42); // slate-900
      doc.rect(0, 0, 210, 24, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(255, 255, 255);
      doc.text(`${academyName.toUpperCase()} · STAFF DIRECTORY`, 14, 11);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(45, 212, 191);
      doc.text(
        `Filters: Position: ${exportPos} | Branch: ${exportBranch} | Total Staff: ${exportStaffMatches.length}`,
        14,
        18,
      );

      const tableRows = exportStaffMatches.map((s) => {
        if (canViewConfidential) {
          return [
            s.name,
            s.position,
            s.branch,
            s.email || "—",
            s.phone || "—",
            s.dob || "—",
            s.salaryType ? `${s.salaryType} (${money(s.salary || 0)})` : "—",
            s.idFile ? "Verified" : "Missing",
          ];
        }
        return [s.name, s.position, s.branch, s.email || "—", s.phone || "—", s.dob || "—"];
      });

      const headCols = canViewConfidential
        ? [["Staff Name", "Position", "Branch", "Email", "Phone", "DOB", "Salary", "ID Doc"]]
        : [["Staff Name", "Position", "Branch", "Email", "Phone", "DOB"]];

      autoTable(doc, {
        startY: 30,
        head: headCols,
        body: tableRows,
        theme: "striped",
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 8,
        },
        styles: {
          fontSize: 7.5,
          cellPadding: 2.5,
          textColor: [30, 41, 59],
        },
      });

      const posTag = exportPos.replace(/\s+/g, "_");
      const branchTag = exportBranch.replace(/\s+/g, "_");
      doc.save(
        `${academyName.replace(/\s+/g, "_")}_Staff_${posTag}_${branchTag}_${new Date().toISOString().slice(0, 10)}.pdf`,
      );
      toast.success("Staff directory (PDF) downloaded successfully.");
      setExportModalOpen(false);
    } catch (err) {
      console.error("PDF export error:", err);
      toast.error("Failed to generate staff directory PDF.");
    }
  }

  const isBranchManager = currentUser?.role === "Branch Manager" && Boolean(currentUser?.branch);
  const userBranch = isBranchManager ? currentUser?.branch || "" : "";

  const accessibleStaff = isBranchManager
    ? staff.filter(
        (s) =>
          s.branches?.some((b) => b.toLowerCase() === userBranch.toLowerCase()) ||
          s.branch?.toLowerCase() === userBranch.toLowerCase(),
      )
    : staff;

  const filtered = accessibleStaff.filter(
    (s) =>
      (!q.trim() ||
        [s.name, s.email, s.phone, s.position].join(" ").toLowerCase().includes(q.toLowerCase())) &&
      (!pos || s.position === pos) &&
      (isBranchManager || !branch || s.branches?.includes(branch) || s.branch === branch),
  );

  function openNew() {
    if (!canManageStaff) return;
    setEditing(null);
    setPendingLedgerEntries([]);
    setForm({ ...blank, id: `s-${Date.now().toString(36)}`, branches: ["HQ"] });
    setModalTab("Profile");
    setOpen(true);
  }
  function openEdit(s: Staff) {
    if (!canManageStaff) return;
    setEditing(s);
    setPendingLedgerEntries([]);
    const { id: _id, ...rest } = s;
    const initialBranches =
      s.branches && s.branches.length > 0 ? s.branches : s.branch ? [s.branch] : ["HQ"];
    setForm({
      ...rest,
      id: s.id,
      branch: s.branch || initialBranches[0] || "HQ",
      branches: initialBranches,
    });
    setModalTab("Profile");
    setOpen(true);
  }
  async function submit() {
    if (!form.name.trim()) {
      toast.error("Please enter staff member name.");
      return;
    }
    const assignedBranches =
      form.branches && form.branches.length > 0 ? form.branches : [form.branch || "HQ"];
    const primaryBranch = assignedBranches[0] || form.branch || "HQ";

    const finalForm = canViewConfidential
      ? form
      : {
          ...form,
          salary: editing ? editing.salary : 0,
          salaryType: editing ? editing.salaryType : "Monthly",
          payments: editing ? editing.payments : [],
          idFile: editing ? editing.idFile : "",
        };
    const staffId = editing ? editing.id : form.id || `s-${Date.now().toString(36)}`;
    const sData: Staff = {
      ...(editing || {}),
      ...finalForm,
      branch: primaryBranch,
      branches: assignedBranches,
      id: staffId,
    };
    try {
      await setEntity("staff", sData);
      if (!editing && pendingLedgerEntries.length > 0) {
        for (const entry of pendingLedgerEntries) {
          await setEntity("ledger", {
            ...entry,
            category: entry.category || "Staff Salaries",
            account: entry.account || "Staff Salaries",
            staffId: sData.id,
            branch: primaryBranch,
            entry: `Salary Payout - ${sData.name}`,
            description: entry.description || `Salary Payout - ${sData.name}`,
          });
        }
      }
      // 100% Universal Accounting Ledger Guarantee: ensure any staff.payments entry has a matching LedgerEntry
      for (const p of sData.payments || []) {
        if (!p || !p.amount) continue;
        const alreadyInLedger =
          (db.ledger || []).some((l) => l.referenceId === p.id) ||
          pendingLedgerEntries.some((l) => l.referenceId === p.id);
        if (!alreadyInLedger) {
          await setEntity("ledger", {
            id: `led-${p.id}`,
            date: p.date || new Date().toISOString().slice(0, 10),
            account: "Staff Salaries",
            category: "Staff Salaries",
            type: "Expense",
            amount: Math.abs(Number(p.amount)),
            status: "Paid",
            branch: primaryBranch,
            entry: `Salary Payout - ${sData.name}`,
            description: p.notes || `Salary Payout - ${sData.name}`,
            note: p.notes || undefined,
            referenceId: p.id,
            staffId: sData.id,
          });
        }
      }
      setPendingLedgerEntries([]);
      toast.success(
        editing ? `Staff profile for ${sData.name} updated.` : `Added ${sData.name} to personnel.`,
      );
    } catch (e) {
      console.warn("Notice saving staff:", e);
    }
    setOpen(false);
  }
  const [deleteTarget, setDeleteTarget] = useState<Staff | null>(null);
  function remove(s: Staff) {
    if (!canManageStaff) return;
    setDeleteTarget(s);
  }
  async function confirmRemove() {
    if (!deleteTarget) return;
    const s = deleteTarget;
    setDeleteTarget(null);
    if (s.payments && s.payments.length > 0) {
      const paymentIds = new Set(s.payments.map((p) => p.id));
      const matchingLedgers = db.ledger.filter(
        (l) => l.referenceId && paymentIds.has(l.referenceId),
      );
      for (const l of matchingLedgers) {
        await deleteEntity("ledger", l.id);
      }
    }
    await deleteEntity("staff", s.id);
  }

  if (authLoading && !currentUser && !user && !passwordUser) {
    return (
      <AppShell crumb="ROSTER / PERSONNEL" title="Personnel">
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-court-500 border-t-transparent" />
          <span className="ml-3 font-mono text-xs text-ink-400">
            Verifying staff authorization credentials...
          </span>
        </div>
      </AppShell>
    );
  }

  if (!hasStaffAccess) {
    return (
      <AppShell crumb="ROSTER / PERSONNEL" title="Personnel">
        <div className="mx-auto max-w-xl py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-warn/10 text-warn border border-warn/20">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 className="font-display text-xl font-bold tracking-tight text-ink-100">
            Access Restricted
          </h2>
          <p className="mt-2 text-sm text-ink-300">
            You do not have permission to view the personnel directory. Contact your Super Admin for
            access permissions.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb="ROSTER / PERSONNEL" title="Personnel">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Staff members" value={String(staff.length)} accent />
        <Stat
          label="Branch managers"
          value={String(staff.filter((s) => s.position === "Branch Manager").length)}
        />
        <Stat label="At HQ" value={String(staff.filter((s) => s.branch === "HQ").length)} />
        <Stat
          label="Missing documents"
          value={canViewConfidential ? String(staff.filter((s) => !s.idFile).length) : "••••"}
          note={
            canViewConfidential ? "upload ID & contract" : "Restricted to Super Admin & Accountant"
          }
        />
      </div>

      <Panel
        className="mt-4"
        title="Staff directory"
        action={
          <>
            <FilterSelect label="Position" value={pos} onChange={setPos} options={positions} />
            <FilterSelect label="Branch" value={branch} onChange={setBranch} options={branches} />
            {canManageStaff && (
              <Button size="md" onClick={openNew}>
                + New staff
              </Button>
            )}
          </>
        }
      >
        <div className="border-b border-ink-800 px-4 py-3 flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="text-court-300 shrink-0 font-medium"
            onClick={() => {
              setExportPos(pos || "All positions");
              setExportBranch(branch || "All branches");
              setExportModalOpen(true);
            }}
          >
            <Download className="w-3.5 h-3.5 text-court-400" />
            <span>Download Staff List</span>
          </Button>

          <div className="flex-1 min-w-[200px]">
            <Search value={q} onChange={setQ} placeholder="Search staff by name, role or email…" />
          </div>
        </div>
        {/* Desktop Table View (>= 640px) */}
        <div className="hidden sm:block">
          <Table
            head={
              <>
                <Th>NAME</Th>
                <Th>POSITION</Th>
                <Th hide>CONTACT</Th>
                <Th hide>BRANCH</Th>
                <Th>
                  <span className="block text-right">DOCUMENTS</span>
                </Th>
              </>
            }
            footer={`SHOWING ${filtered.length} OF ${staff.length}`}
          >
            {filtered.length === 0 ? (
              <EmptyState>No staff match these filters.</EmptyState>
            ) : (
              filtered.map((s) => (
                <Row
                  key={s.id}
                  onClick={() => setHistoryStaffId(s.id)}
                  selected={historyStaffId === s.id}
                >
                  <Td strong>
                    <div className="leading-tight">
                      <div>{s.name}</div>
                      <div className="font-mono text-[10px] text-ink-400">{s.dob || "—"}</div>
                    </div>
                  </Td>
                  <Td>
                    <Chip>{s.position}</Chip>
                  </Td>
                  <Td hide>
                    <div className="leading-tight">
                      <div className="text-xs">{s.email}</div>
                      <div className="font-mono text-[10px] text-ink-400">{s.phone}</div>
                    </div>
                  </Td>
                  <Td hide>
                    <div className="flex flex-wrap gap-1 max-w-[240px]">
                      {s.branches && s.branches.length > 0 ? (
                        s.branches.map((b) => (
                          <Chip key={b} tone="accent">
                            {b}
                          </Chip>
                        ))
                      ) : (
                        <Chip tone="accent">{s.branch || "HQ"}</Chip>
                      )}
                    </div>
                  </Td>
                  <Td right>
                    <div
                      className="flex items-center justify-end gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => setHistoryStaffId(s.id)}
                        className="rounded bg-court-500/10 px-2 py-1 font-mono text-[10px] font-semibold text-court-400 ring-1 ring-court-500/30 hover:bg-court-500/20 transition-colors"
                      >
                        View History
                      </button>
                      {canViewConfidential ? (
                        <Chip tone={s.idFile ? "good" : "warn"}>
                          {s.idFile ? "ID UPLOADED" : "MISSING ID"}
                        </Chip>
                      ) : (
                        <Chip tone="neutral">CONFIDENTIAL</Chip>
                      )}
                      {canManageStaff && (
                        <RowActions onEdit={() => openEdit(s)} onDelete={() => remove(s)} />
                      )}
                    </div>
                  </Td>
                </Row>
              ))
            )}
          </Table>
        </div>

        {/* Mobile Card-Based View (< 640px) */}
        <div className="block sm:hidden divide-y divide-ink-800">
          {filtered.length === 0 ? (
            <EmptyState>No staff match these filters.</EmptyState>
          ) : (
            filtered.map((s) => (
              <div key={s.id} className="p-3.5 space-y-2.5 transition hover:bg-ink-850/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink-100 truncate text-sm">{s.name}</div>
                    <div className="font-mono text-[10px] text-ink-400 mt-0.5">
                      {s.branches?.join(", ") || s.branch || "HQ"} · DOB: {s.dob || "—"}
                    </div>
                  </div>
                  <Chip>{s.position}</Chip>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-ink-900/60 p-2 rounded border border-ink-850">
                  <div className="col-span-2">
                    <span className="text-[10px] text-ink-400 block uppercase">Contact</span>
                    <span className="text-ink-200 truncate block">
                      {s.email || "—"} {s.phone ? `· ${s.phone}` : ""}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-ink-400 block uppercase">Branch</span>
                    <span className="text-ink-200 block truncate">{s.branch || "HQ"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-ink-400 block uppercase">Verification</span>
                    <span
                      className={`block font-semibold ${
                        canViewConfidential
                          ? s.idFile
                            ? "text-good"
                            : "text-warn"
                          : "text-ink-400"
                      }`}
                    >
                      {canViewConfidential
                        ? s.idFile
                          ? "ID Uploaded"
                          : "Missing ID"
                        : "Confidential"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  {canViewConfidential ? (
                    <Chip tone={s.idFile ? "good" : "warn"}>
                      {s.idFile ? "VERIFIED" : "PENDING DOCS"}
                    </Chip>
                  ) : (
                    <Chip tone="neutral">CONFIDENTIAL</Chip>
                  )}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setHistoryStaffId(s.id)}
                      className="rounded bg-court-500/10 px-2 py-1 font-mono text-[10px] font-semibold text-court-400 ring-1 ring-court-500/30 hover:bg-court-500/20"
                    >
                      View History
                    </button>
                    {canManageStaff && (
                      <RowActions onEdit={() => openEdit(s)} onDelete={() => remove(s)} />
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          <div className="p-3 border-t border-ink-800 text-center font-mono text-[10px] text-ink-400 uppercase">
            SHOWING {filtered.length} OF {staff.length}
          </div>
        </div>
      </Panel>

      <Modal
        open={open}
        title={editing ? `Edit ${editing.name}` : "New staff member"}
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel={editing ? "Save changes" : "Add staff"}
        wide
      >
        <div className="flex border-b border-ink-800 px-4">
          <button
            type="button"
            className={`px-4 py-3 text-sm font-medium ${modalTab === "Profile" ? "border-b-2 border-court-500 text-ink-100" : "text-ink-400 hover:text-ink-200"}`}
            onClick={() => setModalTab("Profile")}
          >
            Profile
          </button>
          {canViewConfidential && (
            <button
              type="button"
              className={`px-4 py-3 text-sm font-medium ${modalTab === "Payroll" ? "border-b-2 border-court-500 text-ink-100" : "text-ink-400 hover:text-ink-200"}`}
              onClick={() => setModalTab("Payroll")}
            >
              HR & Payroll
            </button>
          )}
        </div>

        {modalTab === "Profile" ? (
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label="Full name">
              <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            </Field>
            <Field label="Position">
              <Select
                value={form.position}
                onChange={(v) => setForm({ ...form, position: v })}
                options={positions}
              />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            </Field>
            <Field label="Email">
              <Input value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            </Field>
            <div className="sm:col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-ink-300">
                  Assigned Branches (Multi-Branch Assignment)
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const all = [...branches];
                      setForm({ ...form, branches: all, branch: all[0] || "HQ" });
                    }}
                    className="text-[10px] font-mono text-court-400 hover:text-court-300 underline"
                  >
                    Select All
                  </button>
                  <span className="text-ink-600">·</span>
                  <button
                    type="button"
                    onClick={() => {
                      setForm({ ...form, branches: ["HQ"], branch: "HQ" });
                    }}
                    className="text-[10px] font-mono text-ink-400 hover:text-ink-300 underline"
                  >
                    HQ Only
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 p-2.5 rounded-lg bg-ink-850 border border-ink-800">
                {branches.map((bName) => {
                  const isSelected = (form.branches || []).includes(bName);
                  return (
                    <button
                      key={bName}
                      type="button"
                      onClick={() => {
                        const current = new Set(form.branches || []);
                        if (current.has(bName)) {
                          if (current.size > 1) {
                            current.delete(bName);
                          } else {
                            toast.warning("Staff member must belong to at least one branch.");
                            return;
                          }
                        } else {
                          current.add(bName);
                        }
                        const updated = Array.from(current);
                        setForm({
                          ...form,
                          branches: updated,
                          branch: updated[0] || "HQ",
                        });
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition border ${
                        isSelected
                          ? "bg-court-500/20 border-court-500/40 text-court-300 font-semibold"
                          : "bg-ink-900 border-ink-800 text-ink-400 hover:text-ink-200"
                      }`}
                    >
                      <span>{isSelected ? "✓" : "+"}</span>
                      <span>{bName}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-ink-400 font-mono">
                Assigned to: {(form.branches || []).join(", ") || "HQ"}
              </p>
            </div>
            <Field label="Date of birth">
              <Input type="date" value={form.dob} onChange={(v) => setForm({ ...form, dob: v })} />
            </Field>
            {canViewConfidential ? (
              <Field
                label="ID Document"
                hint="Personal ID or passport PDF/Image stored in Firebase Storage"
              >
                <input
                  type="file"
                  accept="image/*,.pdf"
                  disabled={uploadingDoc}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      try {
                        setUploadingDoc(true);
                        const downloadUrl = await uploadStaffDocument(
                          tenantId,
                          editing?.id || `staff_${Date.now()}`,
                          file,
                        );
                        setForm((prev) => ({ ...prev, idFile: downloadUrl }));
                        toast.success("Document uploaded to Firebase Storage.");
                      } catch (err) {
                        console.error("Failed to upload staff document:", err);
                        toast.error("Failed to upload document to Storage.");
                      } finally {
                        setUploadingDoc(false);
                      }
                    }
                  }}
                  className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-200 ring-1 ring-ink-700 file:mr-3 file:rounded file:border-0 file:bg-court-500 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-ink-950 disabled:opacity-50"
                />
                {uploadingDoc && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-court-400 font-mono">
                    <div className="h-2 w-2 animate-ping rounded-full bg-court-400" />
                    Uploading binary document to Firebase Storage...
                  </div>
                )}
                {form.idFile && !uploadingDoc && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-ink-300">
                    <span>Current file:</span>
                    {form.idFile.startsWith("http") ? (
                      <a
                        href={form.idFile}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-court-400 hover:underline"
                      >
                        <span>View uploaded file</span>
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </a>
                    ) : (
                      <span className="font-medium text-ink-100">{form.idFile}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, idFile: "" }))}
                      className="ml-auto text-[11px] text-rose-400 hover:text-rose-300"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </Field>
            ) : (
              <div className="col-span-1 sm:col-span-2 rounded bg-ink-900/60 p-3 border border-ink-800 text-xs font-mono text-ink-400 flex items-center gap-2">
                <span>🔒</span>
                <span>
                  Passport and ID documents are strictly confidential and restricted to Super Admin
                  and Accountant roles.
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 space-y-6">
            <div className="grid gap-3 sm:grid-cols-3 items-end">
              <Field label={`Base Salary (${currency})`}>
                <Input
                  type="number"
                  placeholder="0"
                  value={form.salary !== undefined ? String(form.salary) : "0"}
                  onChange={(v) => setForm({ ...form, salary: Number(v) || 0 })}
                />
              </Field>
              <Field label="Salary Type">
                <Select
                  value={form.salaryType || "Monthly"}
                  onChange={(v) => setForm({ ...form, salaryType: v })}
                  options={["Monthly", "Hourly", "Per Session"]}
                />
              </Field>
              <div className="rounded-md border border-ink-800 bg-ink-900/60 p-2.5 flex flex-col justify-center">
                <span className="font-mono text-[10px] text-ink-400">TOTAL DISBURSED</span>
                <span className="font-mono text-base font-bold text-court-300">
                  {money((form.payments || []).reduce((acc, p) => acc + (p.amount || 0), 0))}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-mono text-xs font-semibold text-court-400">PAYMENT RECORD</h4>
                <div className="flex items-center gap-2">
                  {editing && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        setHistoryStaffId(editing.id);
                      }}
                      className="rounded bg-court-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-court-400 ring-1 ring-court-500/30 hover:bg-court-500/20"
                    >
                      View Full History &amp; Ledger ↗
                    </button>
                  )}
                  <span className="font-mono text-[11px] text-ink-400">
                    {form.payments?.length || 0} recorded payment
                    {form.payments?.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <div className="rounded-md border border-ink-800 overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-ink-900 text-xs font-medium text-ink-400">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Notes</th>
                      <th className="px-3 py-2 w-12 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-800 bg-ink-950">
                    {!form.payments || form.payments.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-ink-400 text-xs">
                          No payments recorded
                        </td>
                      </tr>
                    ) : (
                      form.payments.map((p) => (
                        <tr key={p.id} className="hover:bg-ink-900/40 transition-colors">
                          <td className="px-3 py-2 text-ink-200 font-mono text-xs">{p.date}</td>
                          <td className="px-3 py-2 text-court-300 font-mono font-medium">
                            {money(p.amount || 0)}
                          </td>
                          <td
                            className="px-3 py-2 text-ink-300 truncate max-w-[200px]"
                            title={p.notes}
                          >
                            {p.notes || "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={async () => {
                                const updatedPayments = (form.payments || []).filter(
                                  (x) => x.id !== p.id,
                                );
                                setForm({
                                  ...form,
                                  payments: updatedPayments,
                                });
                                setPendingLedgerEntries((prev) =>
                                  prev.filter((l) => l.referenceId !== p.id),
                                );
                                if (editing) {
                                  await setEntity("staff", {
                                    ...editing,
                                    payments: updatedPayments,
                                  });
                                }
                                const matchingLedger = db.ledger.find(
                                  (l) => l.referenceId === p.id,
                                );
                                if (matchingLedger) {
                                  await deleteEntity("ledger", matchingLedger.id);
                                  toast.success("Salary payment removed from ledger.");
                                }
                              }}
                              className="inline-flex items-center justify-center h-6 w-6 rounded text-ink-400 hover:text-bad hover:bg-bad/10 transition-colors"
                              title="Delete payment entry"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="rounded-md border border-ink-800 bg-ink-900/70 p-3 space-y-3">
                <div className="text-xs font-medium text-ink-300 font-mono">RECORD NEW PAYMENT</div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Date">
                    <Input
                      type="date"
                      value={newPayment.date}
                      onChange={(v) => setNewPayment({ ...newPayment, date: v })}
                    />
                  </Field>
                  <Field label={`Amount (${currency})`}>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={newPayment.amount ? String(newPayment.amount) : ""}
                      onChange={(v) => setNewPayment({ ...newPayment, amount: Number(v) || 0 })}
                    />
                  </Field>
                  <Field label="Notes">
                    <Input
                      value={newPayment.notes}
                      onChange={(v) => setNewPayment({ ...newPayment, notes: v })}
                      placeholder="e.g. October Salary + Bonus"
                    />
                  </Field>
                </div>
                <div className="flex justify-end pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="text-xs"
                    onClick={async () => {
                      if (!newPayment.amount) return;
                      const resolvedStaffId =
                        editing?.id || form.id || `s-${Date.now().toString(36)}`;
                      const paymentId = `pay-${Date.now()}`;
                      const p = { id: paymentId, ...newPayment };
                      const updatedPayments = [...(form.payments || []), p];
                      setForm({ ...form, id: resolvedStaffId, payments: updatedPayments });

                      const staffName = form.name.trim() || editing?.name || "Staff Member";
                      const staffBranch = form.branch || "HQ";
                      const ledgerEntry: LedgerEntry = {
                        id: `led-${Date.now()}`,
                        date: p.date || new Date().toISOString().slice(0, 10),
                        account: "Staff Salaries",
                        category: "Staff Salaries",
                        type: "Expense",
                        amount: Math.abs(p.amount),
                        status: "Paid",
                        branch: staffBranch,
                        entry: "Salary Payout - " + staffName,
                        description: p.notes || "Salary Payout - " + staffName,
                        note: p.notes || undefined,
                        referenceId: p.id,
                        staffId: resolvedStaffId,
                      };

                      if (editing) {
                        try {
                          await setEntity("ledger", ledgerEntry);
                          await setEntity("staff", { ...editing, payments: updatedPayments });
                          toast.success(
                            `Salary payment of ${money(Math.abs(p.amount))} recorded to ledger.`,
                          );
                        } catch (err) {
                          console.error("Failed to sync salary payment to ledger:", err);
                        }
                      } else {
                        setPendingLedgerEntries((prev) => [...prev, ledgerEntry]);
                        toast.success(
                          `Salary payment of ${money(Math.abs(p.amount))} queued — will be committed to ledger when staff profile is saved.`,
                        );
                      }

                      setNewPayment({
                        date: new Date().toISOString().slice(0, 10),
                        amount: 0,
                        notes: "",
                      });
                    }}
                  >
                    + Record Payment
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* MODAL: Download Staff List as CSV or PDF */}
      <Modal
        open={exportModalOpen}
        title="Download Staff List"
        meta="Download personnel directory in CSV or PDF format"
        onClose={() => setExportModalOpen(false)}
      >
        <div className="space-y-4 p-4">
          <p className="text-xs text-ink-300">
            Export a filtered staff directory report. Select a specific position or all positions,
            and filter by branch or all branches.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Filter Position">
              <Select
                value={exportPos}
                onChange={setExportPos}
                options={["All positions", ...positions]}
              />
            </Field>

            <Field label="Filter Branch">
              <Select
                value={exportBranch}
                onChange={setExportBranch}
                options={["All branches", ...branches]}
              />
            </Field>
          </div>

          {/* Matching preview */}
          <div className="rounded-lg border border-ink-800 bg-ink-900/60 p-3 flex items-center justify-between">
            <span className="text-xs text-ink-300">Matching personnel records:</span>
            <Chip tone="accent">
              {exportStaffMatches.length} STAFF MEMBER{exportStaffMatches.length === 1 ? "" : "S"}
            </Chip>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1 flex items-center justify-center gap-2 py-2 text-xs bg-ink-850 hover:bg-ink-800 border-ink-700 text-ink-100"
              onClick={handleExportCSV}
              disabled={exportStaffMatches.length === 0}
            >
              <FileSpreadsheet className="w-4 h-4 text-good" />
              <span>Download CSV</span>
            </Button>

            <Button
              variant="primary"
              className="flex-1 flex items-center justify-center gap-2 py-2 text-xs bg-court-500 hover:bg-court-400 text-ink-950 font-bold"
              onClick={handleExportPDF}
              disabled={exportStaffMatches.length === 0}
            >
              <FileText className="w-4 h-4" />
              <span>Download PDF</span>
            </Button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Staff Profile & Complete History Drawer / Modal (Pillar 4C) */}
      <Modal
        open={Boolean(historyStaff)}
        title={historyStaff ? `${historyStaff.name} · Staff Profile & History` : "Staff History"}
        meta={
          historyStaff
            ? `${historyStaff.position} · ${historyStaff.branches?.join(", ") || historyStaff.branch || "HQ"}`
            : undefined
        }
        onClose={() => {
          setHistoryStaffId(null);
          setEditingStaffPayment(null);
        }}
        wide
      >
        {historyStaff && (
          <div className="p-4 space-y-5 max-h-[75vh] overflow-y-auto">
            {/* Summary Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
              <div className="rounded-lg border border-ink-800 bg-ink-900/70 p-2.5">
                <span className="block text-[10px] text-ink-400 uppercase">Position</span>
                <span className="mt-0.5 block font-semibold text-ink-100">
                  {historyStaff.position}
                </span>
              </div>
              <div className="rounded-lg border border-ink-800 bg-ink-900/70 p-2.5">
                <span className="block text-[10px] text-ink-400 uppercase">Branches</span>
                <span className="mt-0.5 block font-semibold text-court-300 truncate">
                  {historyStaff.branches?.join(", ") || historyStaff.branch || "HQ"}
                </span>
              </div>
              <div className="rounded-lg border border-ink-800 bg-ink-900/70 p-2.5">
                <span className="block text-[10px] text-ink-400 uppercase">Contact</span>
                <span className="mt-0.5 block text-ink-200 truncate">
                  {historyStaff.phone || historyStaff.email || "—"}
                </span>
              </div>
              <div className="rounded-lg border border-ink-800 bg-ink-900/70 p-2.5">
                <span className="block text-[10px] text-ink-400 uppercase">Base Compensation</span>
                <span className="mt-0.5 block font-bold text-court-400">
                  {canViewConfidential
                    ? `${money(historyStaff.salary || 0)} (${historyStaff.salaryType || "Monthly"})`
                    : "Confidential"}
                </span>
              </div>
            </div>

            {/* Section A: Salary & Ledger Payment History */}
            {(() => {
              const staffNameLower = historyStaff.name.toLowerCase().trim();
              const staffPaymentArray = historyStaff.payments || [];
              const staffPaymentIds = new Set(staffPaymentArray.map((p) => p.id));

              const matchingLedgerEntries = (db.ledger || []).filter((l) => {
                const isExp = l.type === "Expense" || (l.type as string) === "debit";
                if (!isExp) return false;
                if (l.staffId === historyStaff.id) return true;
                if (l.referenceId && staffPaymentIds.has(l.referenceId)) return true;
                const hay = `${l.entry || ""} ${l.description || ""} ${l.note || ""}`.toLowerCase();
                return Boolean(staffNameLower && hay.includes(staffNameLower));
              });

              type CombinedPaymentRow = {
                key: string;
                paymentId?: string;
                ledgerId?: string;
                date: string;
                amount: number;
                notes: string;
                sourceLabel: string;
              };

              const rowsMap = new Map<string, CombinedPaymentRow>();

              for (const p of staffPaymentArray) {
                const linkedLedger = matchingLedgerEntries.find((l) => l.referenceId === p.id);
                rowsMap.set(p.id, {
                  key: p.id,
                  paymentId: p.id,
                  ledgerId: linkedLedger?.id,
                  date: p.date,
                  amount: Math.abs(Number(p.amount || 0)),
                  notes:
                    p.notes || linkedLedger?.description || linkedLedger?.entry || "Salary Payment",
                  sourceLabel: linkedLedger ? "Staff + Ledger" : "Staff Record",
                });
              }

              for (const l of matchingLedgerEntries) {
                if (l.referenceId && rowsMap.has(l.referenceId)) continue;
                rowsMap.set(l.id, {
                  key: l.id,
                  ledgerId: l.id,
                  date: l.date,
                  amount: Math.abs(Number(l.amount || 0)),
                  notes: l.note || l.description || l.entry || "Ledger Disbursement",
                  sourceLabel: l.account || "Ledger",
                });
              }

              const allPayments = Array.from(rowsMap.values()).sort((a, b) =>
                (b.date || "").localeCompare(a.date || ""),
              );

              return (
                <div className="space-y-2 border-t border-ink-850 pt-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-court-300">
                      Salary &amp; Ledger Payment History ({allPayments.length})
                    </h4>
                    <span className="font-mono text-xs font-bold text-ink-200">
                      Total Paid:{" "}
                      <strong className="text-court-400">
                        {money(allPayments.reduce((s, r) => s + r.amount, 0))}
                      </strong>
                    </span>
                  </div>

                  {editingStaffPayment && editingStaffPayment.staffId === historyStaff.id && (
                    <div className="rounded-lg border border-court-500/40 bg-court-500/10 p-3 space-y-2.5">
                      <div className="font-mono text-[11px] font-bold text-court-300 uppercase">
                        Edit Staff Payment / Ledger Entry
                      </div>
                      <div className="grid gap-2.5 sm:grid-cols-3">
                        <Field label="Date">
                          <Input
                            type="date"
                            value={editingStaffPayment.date}
                            onChange={(v) =>
                              setEditingStaffPayment({ ...editingStaffPayment, date: v })
                            }
                          />
                        </Field>
                        <Field label={`Amount (${currency})`}>
                          <Input
                            type="number"
                            value={String(editingStaffPayment.amount)}
                            onChange={(v) =>
                              setEditingStaffPayment({
                                ...editingStaffPayment,
                                amount: Number(v) || 0,
                              })
                            }
                          />
                        </Field>
                        <Field label="Notes / Description">
                          <Input
                            value={editingStaffPayment.notes}
                            onChange={(v) =>
                              setEditingStaffPayment({ ...editingStaffPayment, notes: v })
                            }
                          />
                        </Field>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setEditingStaffPayment(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          size="xs"
                          onClick={async () => {
                            const { paymentId, ledgerId, date, amount, notes } =
                              editingStaffPayment;
                            if (paymentId) {
                              const updatedPayments = (historyStaff.payments || []).map((p) =>
                                p.id === paymentId ? { ...p, date, amount, notes } : p,
                              );
                              await setEntity("staff", {
                                ...historyStaff,
                                payments: updatedPayments,
                              });
                            }
                            if (ledgerId) {
                              await editLedgerTransaction(ledgerId, {
                                date,
                                amount: Math.abs(amount),
                                note: notes,
                                description: notes,
                              });
                            } else if (paymentId) {
                              await setEntity("ledger", {
                                id: `led-${paymentId}`,
                                date: date || new Date().toISOString().slice(0, 10),
                                account: "Staff Salaries",
                                category: "Staff Salaries",
                                type: "Expense",
                                amount: Math.abs(amount),
                                status: "Paid",
                                branch: historyStaff.branch || "HQ",
                                entry: `Salary Payout - ${historyStaff.name}`,
                                description: notes || `Salary Payout - ${historyStaff.name}`,
                                note: notes || undefined,
                                referenceId: paymentId,
                                staffId: historyStaff.id,
                              });
                            }
                            toast.success(`Updated payment record for ${historyStaff.name}.`);
                            setEditingStaffPayment(null);
                          }}
                        >
                          Save Payment Changes
                        </Button>
                      </div>
                    </div>
                  )}

                  {allPayments.length === 0 ? (
                    <div className="rounded bg-ink-900/50 p-3 font-mono text-xs text-ink-500">
                      No salary or ledger payments recorded yet for {historyStaff.name}.
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
                      {allPayments.map((row) => (
                        <div
                          key={row.key}
                          className="flex flex-wrap items-center justify-between gap-2 rounded bg-ink-900/70 p-2.5 border border-ink-800 text-xs"
                        >
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-court-400">
                                {money(row.amount)}
                              </span>
                              <span className="font-mono text-[10px] text-ink-400">{row.date}</span>
                              <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] text-ink-300">
                                {row.sourceLabel}
                              </span>
                            </div>
                            <div className="font-mono text-[11px] text-ink-300 truncate">
                              {row.notes}
                            </div>
                          </div>
                          {canViewConfidential && (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingStaffPayment({
                                    staffId: historyStaff.id,
                                    paymentId: row.paymentId,
                                    ledgerId: row.ledgerId,
                                    date: row.date,
                                    amount: row.amount,
                                    notes: row.notes,
                                  })
                                }
                                className="rounded bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-200 ring-1 ring-ink-700 hover:text-court-300"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (row.ledgerId) {
                                    await deleteLedgerTransaction(row.ledgerId);
                                  } else if (row.paymentId) {
                                    const updatedPayments = (historyStaff.payments || []).filter(
                                      (p) => p.id !== row.paymentId,
                                    );
                                    await setEntity("staff", {
                                      ...historyStaff,
                                      payments: updatedPayments,
                                    });
                                  }
                                  toast.success(
                                    `Undid ${money(row.amount)} payment for ${historyStaff.name}.`,
                                  );
                                }}
                                className="rounded bg-bad/15 px-2 py-0.5 font-mono text-[10px] text-bad ring-1 ring-bad/30 hover:bg-bad/25"
                              >
                                Undo / Delete
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Section B: Match Officiating & Game Staff History */}
            {(() => {
              const staffNameLower = historyStaff.name.toLowerCase().trim();
              type OfficiatingAssignment = {
                id: string;
                sessionId: string;
                date: string;
                gameTitle: string;
                role: string;
                fee: number;
                ledgerStatus: string;
              };

              const assignments: OfficiatingAssignment[] = [];

              for (const sess of db.sessions || []) {
                const allOfficials = [
                  ...(sess.referees || []).map((r) => ({ ...r, defaultGroup: "Referee" })),
                  ...(sess.matchStaff || []).map((m) => ({ ...m, defaultGroup: "Game Staff" })),
                ];
                for (const off of allOfficials) {
                  const matchById = Boolean(off.personnelId && off.personnelId === historyStaff.id);
                  const matchByName = Boolean(
                    staffNameLower && off.name && off.name.toLowerCase().trim() === staffNameLower,
                  );
                  if (matchById || matchByName) {
                    const ledgerId = `match-fee-${sess.id}-${off.id}`;
                    const ledgerEntry = (db.ledger || []).find(
                      (l) => l.id === ledgerId || l.referenceId === off.id,
                    );
                    assignments.push({
                      id: `${sess.id}-${off.id}`,
                      sessionId: sess.id,
                      date: sess.date || "",
                      gameTitle:
                        sess.title ||
                        [sess.teamA, sess.teamB].filter(Boolean).join(" vs ") ||
                        "Game",
                      role: off.role || off.defaultGroup,
                      fee: Number(off.fee || ledgerEntry?.amount || 0),
                      ledgerStatus: ledgerEntry?.status || off.status || "Recorded",
                    });
                  }
                }
              }

              assignments.sort((a, b) => b.date.localeCompare(a.date));

              return (
                <div className="space-y-2 border-t border-ink-850 pt-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-court-300">
                      Match Officiating &amp; Game Staff History ({assignments.length})
                    </h4>
                    <span className="font-mono text-xs text-ink-300">
                      Fees Earned:{" "}
                      <strong className="text-court-400">
                        {money(assignments.reduce((s, a) => s + a.fee, 0))}
                      </strong>
                    </span>
                  </div>
                  {assignments.length === 0 ? (
                    <div className="rounded bg-ink-900/50 p-3 font-mono text-xs text-ink-500">
                      No match officiating or game table assignments found for {historyStaff.name}.
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                      {assignments.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 rounded bg-ink-900/70 p-2.5 border border-ink-800 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-ink-100 truncate">
                              {item.gameTitle}
                            </div>
                            <div className="font-mono text-[10px] text-ink-400">
                              {item.date} · Role:{" "}
                              <strong className="text-court-300">{item.role}</strong>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 font-mono">
                            <span className="font-bold text-court-400">{money(item.fee)}</span>
                            <span className="rounded bg-good/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-good ring-1 ring-good/30">
                              {item.ledgerStatus}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Section C: Staff Activity & Audit Log */}
            {(() => {
              const staffNameLower = historyStaff.name.toLowerCase().trim();
              const auditEntries = (db.auditLogs || []).filter((log) => {
                if (log.targetId === historyStaff.id) return true;
                const hay =
                  `${log.targetName || ""} ${log.action || ""} ${log.title || ""} ${log.details || ""} ${log.message || ""}`.toLowerCase();
                return (
                  hay.includes(historyStaff.id.toLowerCase()) ||
                  Boolean(staffNameLower && hay.includes(staffNameLower))
                );
              });

              const notifEntries = (db.notifications || [])
                .filter((n) => {
                  const hay = `${n.title || ""} ${n.message || ""}`.toLowerCase();
                  return (
                    hay.includes(historyStaff.id.toLowerCase()) ||
                    Boolean(staffNameLower && hay.includes(staffNameLower))
                  );
                })
                .map((n) => ({
                  id: `notif-${n.id}`,
                  timestamp: n.createdAt,
                  title: n.title,
                  details: n.message,
                }));

              const combinedAudit = [
                ...auditEntries.map((a) => ({
                  id: a.id,
                  timestamp: a.timestamp || a.createdAt || "",
                  title: a.action || a.title || "Staff Audit Event",
                  details: a.details || a.message || "",
                })),
                ...notifEntries,
              ].sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

              return (
                <div className="space-y-2 border-t border-ink-850 pt-3">
                  <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-court-300">
                    Staff Activity &amp; Audit Log ({combinedAudit.length})
                  </h4>
                  {combinedAudit.length === 0 ? (
                    <div className="rounded bg-ink-900/50 p-3 font-mono text-xs text-ink-500">
                      No audit log events recorded for {historyStaff.name}.
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                      {combinedAudit.map((evt) => (
                        <div
                          key={evt.id}
                          className="rounded bg-ink-900/70 p-2 border border-ink-800 text-xs space-y-0.5"
                        >
                          <div className="flex items-center justify-between gap-2 font-mono">
                            <span className="font-semibold text-ink-100 truncate">{evt.title}</span>
                            <span className="text-[10px] text-ink-400 shrink-0">
                              {(evt.timestamp || "").slice(0, 10)}
                            </span>
                          </div>
                          {evt.details && (
                            <div className="text-[11px] text-ink-300">{evt.details}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        title="Remove staff member"
        meta={deleteTarget ? `Remove "${deleteTarget.name}" from personnel` : undefined}
        onClose={() => setDeleteTarget(null)}
        onSubmit={() => void confirmRemove()}
        submitLabel="Remove staff"
      >
        <div className="p-4 text-sm text-ink-200">
          Are you sure you want to remove{" "}
          <span className="font-semibold text-ink-100">{deleteTarget?.name}</span> from personnel?
        </div>
      </Modal>
    </AppShell>
  );
}

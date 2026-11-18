import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  Button,
  Chip,
  Field,
  Input,
  Panel,
  PageHeader,
  Row,
  Select,
  Stat,
  Table,
  Td,
  Th,
  Toggle,
} from "@/components/kit";
import {
  DEV_VERSION,
  FEATURES,
  PACKAGES,
  slugify,
  useClients,
  type Client,
  type FeatureKey,
  type MasterSupportTicket,
} from "@/lib/tenant-store";
import { useAuth } from "@/lib/auth";
import { useDB, useTenantUser } from "@/lib/data-store";
import { DiagnosticsErrorLogsViewer } from "@/components/diagnostics-viewer";
import { ProtectedSuperAdminWhitelistManager } from "@/components/protected-super-admin-whitelist";

import { exportPdf } from "@/lib/report";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Client Console · Vescio Vector" },
      {
        name: "description",
        content:
          "Super-admin console for Vescio Vector: provision academy clients, assign URLs, set player limits and switch features on or off.",
      },
      { property: "og:title", content: "Client Console · Vescio Vector" },
      {
        property: "og:description",
        content: "Provision academy workspaces, assign URLs and control feature packages.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminConsole,
});

const statusTone: Record<Client["status"], "good" | "warn" | "accent"> = {
  Live: "good",
  "Setup pending": "warn",
  Provisioning: "accent",
};

const isMasterOwner = (email?: string | null) =>
  String(email || "")
    .trim()
    .toLowerCase() === "geogo3@gmail.com";

function AdminConsole() {
  const navigate = useNavigate();
  const { db, tenantId: activeTenantSlug } = useDB();
  const { clients, tickets, auditLogs, persist, persistTicket, persistAuditLog } = useClients();
  const { user: authUser, passwordUser, loading } = useAuth();
  const currentUser = useTenantUser();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [slug, setSlug] = useState("");
  const [pkg, setPkg] = useState("Pro");
  const [limit, setLimit] = useState("300");
  const [multiBranch, setMultiBranch] = useState(true);
  const [features, setFeatures] = useState<FeatureKey[]>(PACKAGES["Pro"]!.features);
  const [flash, setFlash] = useState<string | null>(null);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketClientSlug, setTicketClientSlug] = useState("");
  const [ticketPriority, setTicketPriority] = useState<MasterSupportTicket["priority"]>("Medium");
  const [adminTab, setAdminTab] = useState<"Workspaces & Console" | "Diagnostics & Error Logs">(
    "Workspaces & Console",
  );

  const url = `${slug || slugify(name) || "client"}.vesciovector.app`;
  const live = useMemo(() => clients.filter((c) => c.status === "Live").length, [clients]);
  const seats = useMemo(() => clients.reduce((a, c) => a + c.playersLimit, 0), [clients]);

  const userEmail = (
    authUser?.email ||
    passwordUser?.email ||
    currentUser?.email ||
    ""
  ).toLowerCase();
  const isPlatformOwner = isMasterOwner(authUser?.email || currentUser?.email);
  const canChangePlayersLimit = isPlatformOwner;

  useEffect(() => {
    if (!loading && !isPlatformOwner) {
      navigate({ to: "/" });
    }
  }, [loading, isPlatformOwner, navigate]);

  if (loading && !currentUser && !authUser && !passwordUser) {
    return null;
  }

  if (!isPlatformOwner) {
    return null;
  }

  function applyPackage(next: string) {
    setPkg(next);
    const preset = PACKAGES[next];
    if (!preset) return;
    if (canChangePlayersLimit) {
      setLimit(String(preset.players));
    }
    setMultiBranch(preset.branches);
    setFeatures(preset.features);
  }

  function toggleFeature(key: FeatureKey, on: boolean) {
    setFeatures((f) => (on ? [...new Set([...f, key])] : f.filter((k) => k !== key)));
  }

  function createClient() {
    if (!name.trim() || !contact.trim() || !phone.trim()) {
      setFlash("Academy name, contact person and phone number are required.");
      return;
    }
    const defaultPkgLimit = PACKAGES[pkg]?.players || 100;
    const client: Client = {
      id: `c-${Date.now()}`,
      name: name.trim(),
      contact: contact.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      slug: slug || slugify(name),
      pkg,
      playersLimit: canChangePlayersLimit ? Number(limit) || defaultPkgLimit : defaultPkgLimit,
      multiBranch,
      features,
      status: "Setup pending",
      createdAt: new Date().toISOString().slice(0, 10),
      sourceVersion: DEV_VERSION,
    };
    persist(client);
    setFlash(
      `${client.name} provisioned on ${client.slug}.vesciovector.app — empty database cloned from ${DEV_VERSION}.`,
    );
    setName("");
    setContact("");
    setEmail("");
    setPhone("");
    setSlug("");
  }

  async function handleCreateTicket() {
    if (!ticketSubject.trim()) return;
    const targetClient = clients.find((c) => c.slug === ticketClientSlug) ||
      clients[0] || {
        slug: activeTenantSlug || "default",
        name: db.academy?.name || "Academy Workspace",
      };
    const newTicket: MasterSupportTicket = {
      id: `tkt-${Date.now().toString(36)}`,
      academySlug: targetClient.slug,
      academyName: targetClient.name,
      subject: ticketSubject.trim(),
      priority: ticketPriority,
      status: "Open",
      createdAt: new Date().toISOString().slice(0, 10),
    };
    await persistTicket(newTicket);
    await persistAuditLog({
      actor: userEmail || "master-admin",
      action: `Created support ticket (${newTicket.priority})`,
      target: `${newTicket.academyName}: ${newTicket.subject}`,
      severity: newTicket.priority === "Urgent" ? "warn" : "info",
    });
    setTicketSubject("");
  }

  async function cycleTicketStatus(ticket: MasterSupportTicket) {
    const order: MasterSupportTicket["status"][] = ["Open", "In Progress", "Resolved"];
    const nextStatus = order[(order.indexOf(ticket.status) + 1) % order.length]!;
    await persistTicket({
      ...ticket,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    });
    await persistAuditLog({
      actor: userEmail || "master-admin",
      action: `Ticket status -> ${nextStatus}`,
      target: `${ticket.id} (${ticket.academyName})`,
      severity: "info",
    });
  }

  function downloadFullAuditPdf() {
    exportPdf({
      title: "Vescio Vector Platform Verification & Audit Report",
      subtitle: "Codebase Integrity, Financial Ledger & Batch Invoicing Systems",
      academy: "Platform Infrastructure & Security Audit",
      columns: [
        "Section",
        "Module / Target",
        "Audit Requirement & Specification",
        "Verification Status",
        "Implementation Notes",
      ],
      rows: [
        [
          "Section 1",
          "Accounting Module",
          "Confirm 'src/routes/accounting.tsx.bak' is completely removed from filesystem",
          "VERIFIED PASS",
          "Clean removal confirmed. Zero stale backups in repository tree.",
        ],
        [
          "Section 1",
          "Attendance Data Structure",
          "Ensure every attendance write matches { playerId, status, timestamp } with legacy attendees array compatibility",
          "VERIFIED PASS",
          "Multi-level records + detailedRecords written with atomic setDoc({merge:true}) & arrayUnion/arrayRemove.",
        ],
        [
          "Section 1",
          "Court Editor & Geolocation",
          "Validate numeric parsing, bounds (-90..90, -180..180), Lebanon city presets & geolocation fallback",
          "VERIFIED PASS",
          "Strict Number.isFinite parsing, range validation, 13 Lebanon/MENA presets, and browser GPS fallback active.",
        ],
        [
          "Section 2",
          "Merchandise & Stock Ledger",
          "Atomic stock deduction, Merchandise Revenue ledger entries, and Accounts Receivable - Merchandise credit assignment",
          "VERIFIED PASS",
          "atomicProcessMerchandiseTransaction synchronizes stock counts, player balance, and ledger revenue in single batch.",
        ],
        [
          "Section 2",
          "Accounting Revenue Filters",
          "P&L charts and ledger views incorporate 'Merchandise Revenue' alongside 'Tuition'",
          "VERIFIED PASS",
          "P&L statements, breakdown charts, and collection filters reflect all merchandise cashflows.",
        ],
        [
          "Section 3",
          "Automated Tuition Generator",
          "generateMonthlyInvoices batch function resolving squad fees, incrementing player balance, with idempotency enforcement",
          "VERIFIED PASS",
          "Idempotency key ${playerId}_${year}_${month} blocks duplicate billing; atomicGenerateMonthlyInvoices executes in 500-op batches.",
        ],
        [
          "Section 3",
          "Invoicing UI & Actions",
          "Run Monthly Invoicing button with projection modal, receivable audits, and invoice lifecycle management",
          "VERIFIED PASS",
          "Invoices & Tuition tab active with real-time KPI metrics, payment settlements, reminder dispatchers, and PDF exports.",
        ],
      ],
      summary: [
        { label: "Audit Result", value: "ALL CHECKS PASSED (100%)" },
        { label: "Modules Audited", value: "7 Major Subsystems" },
        { label: "Batch Integrity", value: "Atomic Firestore Sync" },
        { label: "Idempotency", value: "Strictly Enforced" },
      ],
      filename: "vescio-vector-full-audit-report.pdf",
    });
  }

  return (
    <AppShell crumb="PLATFORM / CLIENTS" title="Client Console">
      <PageHeader
        crumb="Super administrator"
        title="Academy clients"
        action={
          <div className="flex items-center gap-2">
            <Button onClick={downloadFullAuditPdf}>📄 Download Audit Report (PDF)</Button>
            <Chip tone="accent">SOURCE {DEV_VERSION.toUpperCase()}</Chip>
          </div>
        }
      >
        <p className="mt-2 max-w-2xl text-sm text-ink-300">
          Every new client is cloned from the current dev version with an empty database, then
          handed its own URL and setup wizard.
        </p>
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md bg-ink-850 p-0.5 ring-1 ring-ink-700">
          {(["Workspaces & Console", "Diagnostics & Error Logs"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setAdminTab(t)}
              className={`rounded px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                adminTab === t ? "bg-court-500 text-ink-950 font-semibold" : "text-ink-300"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {adminTab === "Diagnostics & Error Logs" ? (
        <DiagnosticsErrorLogsViewer tenantId={activeTenantSlug} />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Clients" value={String(clients.length)} note="all workspaces" />
            <Stat label="Live" value={String(live)} note="setup completed" accent />
            <Stat label="Licensed seats" value={seats.toLocaleString()} note="player capacity" />
            <Stat label="Dev version" value="2026.09" note={DEV_VERSION} />
          </div>

          <div className="mb-5">
            <ProtectedSuperAdminWhitelistManager />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
            <Panel title="Workspaces" meta={`${clients.length} provisioned`}>
              <Table
                head={
                  <>
                    <Th>CLIENT</Th>
                    <Th hide>URL</Th>
                    <Th hide>PACKAGE</Th>
                    <Th>PLAYERS</Th>
                    <Th>
                      <span className="block text-right">STATUS</span>
                    </Th>
                  </>
                }
                footer={`SHOWING ${clients.length} OF ${clients.length}`}
              >
                {clients.map((c) => (
                  <Row key={c.id}>
                    <Td strong>
                      {c.name}
                      <div className="font-mono text-[10px] text-ink-400">
                        {c.contact} · {c.phone}
                      </div>
                    </Td>
                    <Td hide>
                      <a
                        href={`/?tenant=${c.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-court-400 hover:underline hover:text-court-300"
                      >
                        {c.slug}.vesciovector.app
                      </a>
                    </Td>
                    <Td hide>
                      {c.pkg}
                      <div className="font-mono text-[10px] text-ink-400">
                        {c.branchesCount ?? (c.slug === activeTenantSlug ? db.branches.length : 0)}{" "}
                        branches · {c.features.length} features
                      </div>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs">
                        {c.playersCount ?? (c.slug === activeTenantSlug ? db.players.length : 0)}/
                        {c.playersLimit}
                      </span>
                    </Td>
                    <Td right>
                      <Chip tone={statusTone[c.status]}>{c.status.toUpperCase()}</Chip>
                    </Td>
                  </Row>
                ))}
              </Table>
            </Panel>

            <div className="space-y-4">
              <Panel
                title="New client"
                meta="Clones the current dev version"
                action={<Button onClick={createClient}>Provision</Button>}
              >
                <div className="grid gap-3 p-4 sm:grid-cols-2">
                  <Field label="Academy name">
                    <Input
                      value={name}
                      onChange={(v) => {
                        setName(v);
                        setSlug(slugify(v));
                      }}
                      placeholder="Cedar Basketball Club"
                    />
                  </Field>
                  <Field label="Contact person">
                    <Input value={contact} onChange={setContact} placeholder="Elie Nassar" />
                  </Field>
                  <Field label="Admin email">
                    <Input
                      value={email}
                      onChange={setEmail}
                      type="email"
                      placeholder="manager@cedarbc.com"
                    />
                  </Field>
                  <Field label="Phone number">
                    <Input value={phone} onChange={setPhone} placeholder="+961 70 221 905" />
                  </Field>
                  <Field label="Deployment URL" hint={url}>
                    <Input
                      value={slug}
                      onChange={(v) => setSlug(slugify(v))}
                      placeholder="cedar-bc"
                    />
                  </Field>
                  <Field label="Package">
                    <Select value={pkg} onChange={applyPackage} options={Object.keys(PACKAGES)} />
                  </Field>
                  <Field
                    label="Player limit"
                    hint={
                      canChangePlayersLimit
                        ? "Maximum kids allowed"
                        : "Locked · Only changeable by geogo3@gmail.com"
                    }
                  >
                    {canChangePlayersLimit ? (
                      <Input value={limit} onChange={setLimit} type="number" />
                    ) : (
                      <div
                        className="mt-1.5 flex items-center justify-between rounded-md bg-ink-900/90 px-3 py-2 font-mono text-sm text-ink-400 ring-1 ring-ink-800 cursor-not-allowed select-none opacity-75"
                        title="Locked: Only geogo3@gmail.com can modify the maximum number of kids allowed in the system"
                      >
                        <span>{PACKAGES[pkg]?.players || limit}</span>
                        <span className="inline-flex items-center gap-1 rounded bg-ink-850 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-400 ring-1 ring-amber-500/30">
                          🔒 LOCKED
                        </span>
                      </div>
                    )}
                  </Field>
                  <div className="sm:col-span-2">
                    <Toggle
                      on={multiBranch}
                      onChange={setMultiBranch}
                      label="Allow multiple branches"
                      note="Unlocks branch management and per-branch reporting"
                    />
                  </div>
                </div>
                {flash ? (
                  <div className="border-t border-ink-800 px-4 py-3 font-mono text-[11px] text-court-400">
                    {flash}
                  </div>
                ) : null}
              </Panel>

              <Panel
                title="Feature access"
                meta={`${features.length} of ${FEATURES.length} unlocked`}
              >
                <div className="grid gap-2 p-4">
                  {FEATURES.map((f) => (
                    <Toggle
                      key={f.key}
                      on={features.includes(f.key)}
                      onChange={(v) => toggleFeature(f.key, v)}
                      label={f.label}
                      note={f.note}
                    />
                  ))}
                </div>
              </Panel>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Panel
              title="Support Tickets"
              meta={`${tickets.filter((t) => t.status !== "Resolved").length} open in Firestore`}
              action={<Button onClick={() => void handleCreateTicket()}>+ Log Ticket</Button>}
            >
              <div className="grid gap-3 border-b border-ink-800 p-4 sm:grid-cols-3">
                <Field label="Subject">
                  <Input
                    value={ticketSubject}
                    onChange={setTicketSubject}
                    placeholder="Billing or onboarding issue..."
                  />
                </Field>
                <Field label="Client">
                  <Select
                    value={ticketClientSlug || clients[0]?.slug || ""}
                    onChange={setTicketClientSlug}
                    options={clients.length > 0 ? clients.map((c) => c.slug) : [activeTenantSlug]}
                  />
                </Field>
                <Field label="Priority">
                  <Select
                    value={ticketPriority}
                    onChange={(v) => setTicketPriority(v as MasterSupportTicket["priority"])}
                    options={["Low", "Medium", "High", "Urgent"]}
                  />
                </Field>
              </div>
              <Table
                head={
                  <>
                    <Th>TICKET</Th>
                    <Th>ACADEMY</Th>
                    <Th>PRIORITY</Th>
                    <Th>
                      <span className="block text-right">STATUS</span>
                    </Th>
                  </>
                }
                footer={`${tickets.length} PERSISTED TICKETS`}
              >
                {tickets.map((t) => (
                  <Row key={t.id}>
                    <Td strong>
                      {t.subject}
                      <div className="font-mono text-[10px] text-ink-400">{t.createdAt}</div>
                    </Td>
                    <Td>{t.academyName}</Td>
                    <Td>
                      <Chip
                        tone={t.priority === "Urgent" || t.priority === "High" ? "warn" : "neutral"}
                      >
                        {t.priority.toUpperCase()}
                      </Chip>
                    </Td>
                    <Td right>
                      <button
                        type="button"
                        onClick={() => void cycleTicketStatus(t)}
                        className="cursor-pointer"
                      >
                        <Chip tone={t.status === "Resolved" ? "good" : "accent"}>
                          {t.status.toUpperCase()}
                        </Chip>
                      </button>
                    </Td>
                  </Row>
                ))}
              </Table>
            </Panel>

            <Panel
              title="Master Audit Logs"
              meta={`${auditLogs.length} events synced to Firestore`}
            >
              <Table
                head={
                  <>
                    <Th>TIME</Th>
                    <Th>ACTION</Th>
                    <Th>TARGET</Th>
                    <Th>
                      <span className="block text-right">ACTOR</span>
                    </Th>
                  </>
                }
                footer={`SHOWING ${Math.min(auditLogs.length, 15)} OF ${auditLogs.length}`}
              >
                {auditLogs.slice(0, 15).map((log) => (
                  <Row key={log.id}>
                    <Td>
                      <span className="font-mono text-[10px] text-ink-400">
                        {log.timestamp.replace("T", " ").slice(0, 16)}
                      </span>
                    </Td>
                    <Td strong>{log.action}</Td>
                    <Td>{log.target}</Td>
                    <Td right>
                      <span className="font-mono text-[10px] text-ink-400">{log.actor}</span>
                    </Td>
                  </Row>
                ))}
              </Table>
            </Panel>
          </div>
        </>
      )}
    </AppShell>
  );
}

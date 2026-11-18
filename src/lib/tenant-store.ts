import { useCallback, useEffect, useState } from "react";
import { collection, onSnapshot, doc, setDoc, writeBatch } from "firebase/firestore";
import { db as firestore } from "./firebase";
import { useAuth } from "./auth";
import { emptyDB } from "./data-store";
import { cleanFirestoreData } from "./firestore-sync";
import { getTenantSlug, DEFAULT_TENANT_SLUG, normalizeTenantSlug, setTenantSlug } from "./utils";

export { getTenantSlug, DEFAULT_TENANT_SLUG, normalizeTenantSlug, setTenantSlug };

export const FEATURES = [
  { key: "calendar", label: "Calendar & scheduling", note: "Month / week / day planning" },
  { key: "sessions", label: "Sessions & attendance", note: "Practices, games, check-in" },
  { key: "players", label: "Player database", note: "Profiles, fees, documents" },
  { key: "teams", label: "Teams & rosters", note: "Age validation, assignments" },
  { key: "accounting", label: "Accounting", note: "Invoices, ledger, reports" },
  { key: "merchandise", label: "Merchandise & stock", note: "Inventory, orders, suppliers" },
  { key: "technical", label: "Technical portal", note: "Plans, approvals, seminars" },
  { key: "coach", label: "Coach mobile portal", note: "Geo check-in, attendance" },
  { key: "whatsapp", label: "WhatsApp communications", note: "Automated reminders" },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];

export const PACKAGES: Record<
  string,
  { players: number; branches: boolean; features: FeatureKey[] }
> = {
  Starter: {
    players: 100,
    branches: false,
    features: ["calendar", "sessions", "players", "teams"],
  },
  Pro: {
    players: 300,
    branches: true,
    features: ["calendar", "sessions", "players", "teams", "accounting", "merchandise", "coach"],
  },
  Elite: {
    players: 1000,
    branches: true,
    features: FEATURES.map((f) => f.key),
  },
};

export type Client = {
  id: string;
  name: string;
  contact: string;
  email?: string;
  phone: string;
  slug: string;
  pkg: string;
  playersLimit: number;
  playersCount?: number;
  branchesCount?: number;
  multiBranch: boolean;
  features: FeatureKey[];
  status: "Provisioning" | "Setup pending" | "Live";
  createdAt: string;
  sourceVersion: string;
};

export type MasterSupportTicket = {
  id: string;
  academySlug: string;
  academyName: string;
  subject: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  status: "Open" | "In Progress" | "Resolved";
  createdAt: string;
  updatedAt?: string;
};

export type MasterAuditLog = {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  severity: "info" | "warn" | "critical";
};

export const DEV_VERSION = "dev-2026.09.07";

export function useClients() {
  const [rawClients, setRawClients] = useState<Client[]>([]);
  const [tenantCounts, setTenantCounts] = useState<
    Record<string, { playersCount?: number; branchesCount?: number; status?: Client["status"] }>
  >({});
  const [tickets, setTickets] = useState<MasterSupportTicket[]>([]);
  const [auditLogs, setAuditLogs] = useState<MasterAuditLog[]>([]);
  const [ready, setReady] = useState(false);
  const { user, passwordUser } = useAuth();
  const currentUser = user || passwordUser;

  useEffect(() => {
    const email = currentUser?.email?.toLowerCase();
    if (email !== "geogo3@gmail.com") {
      setRawClients([]);
      setReady(true);
      return;
    }

    let isMounted = true;
    const unsubClients = onSnapshot(
      collection(firestore, "platformClients"),
      (snap) => {
        if (!isMounted) return;
        const data = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Client);
        data.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setRawClients(data);
        setReady(true);
      },
      (error) => {
        console.warn("platformClients snapshot silenced for staff:", error.message);
        if (isMounted) {
          setReady(true);
        }
      },
    );

    const unsubTenants = onSnapshot(
      collection(firestore, "tenants"),
      (snap) => {
        if (!isMounted) return;
        const countsMap: Record<
          string,
          { playersCount?: number; branchesCount?: number; status?: Client["status"] }
        > = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          const slug = (typeof data.slug === "string" && data.slug) || d.id;
          const playersCount =
            typeof data.playersCount === "number"
              ? data.playersCount
              : typeof data.playersUsed === "number"
                ? data.playersUsed
                : undefined;
          const branchesCount =
            typeof data.branchesCount === "number"
              ? data.branchesCount
              : typeof data.branchesUsed === "number"
                ? data.branchesUsed
                : undefined;
          const status =
            data.setupDone === true || data.status === "Live" ? ("Live" as const) : undefined;
          countsMap[slug] = { playersCount, branchesCount, status };
          countsMap[d.id] = { playersCount, branchesCount, status };
        });
        setTenantCounts(countsMap);
      },
      () => {},
    );

    const unsubTickets = onSnapshot(
      collection(firestore, "master_console", "global", "tickets"),
      (snap) => {
        if (!isMounted) return;
        const items = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as MasterSupportTicket);
        items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setTickets(items);
      },
      () => {},
    );

    const unsubAudit = onSnapshot(
      collection(firestore, "master_console", "global", "auditLogs"),
      (snap) => {
        if (!isMounted) return;
        const items = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as MasterAuditLog);
        items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        setAuditLogs(items);
      },
      () => {},
    );

    return () => {
      isMounted = false;
      unsubClients();
      unsubTenants();
      unsubTickets();
      unsubAudit();
    };
  }, [currentUser?.email]);

  const clients = rawClients.map((c) => {
    const tc = tenantCounts[c.slug] || tenantCounts[c.id];
    return {
      ...c,
      playersCount: tc?.playersCount ?? c.playersCount ?? 0,
      branchesCount: tc?.branchesCount ?? c.branchesCount ?? 0,
      status: tc?.status ?? c.status,
    };
  });

  const persistAuditLog = useCallback(async (entry: Omit<MasterAuditLog, "id" | "timestamp">) => {
    const id = `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const full: MasterAuditLog = {
      ...entry,
      id,
      timestamp: new Date().toISOString(),
    };
    await setDoc(
      doc(firestore, "master_console", "global", "auditLogs", id),
      cleanFirestoreData(full),
      {
        merge: true,
      },
    );
  }, []);

  const persistTicket = useCallback(async (ticket: MasterSupportTicket) => {
    await setDoc(
      doc(firestore, "master_console", "global", "tickets", ticket.id),
      cleanFirestoreData(ticket),
      {
        merge: true,
      },
    );
  }, []);

  const persist = useCallback(
    async (client: Client) => {
      const batch = writeBatch(firestore);
      const targetSlug = normalizeTenantSlug(client.slug);
      const normalizedClient: Client = {
        ...client,
        slug: targetSlug,
        features: Array.isArray(client.features) ? client.features : FEATURES.map((f) => f.key),
      };

      // Create the platform client record
      batch.set(
        doc(firestore, "platformClients", normalizedClient.id),
        cleanFirestoreData(normalizedClient),
      );

      // Initialize the tenant document (meta fields + summary counts + RBAC credentials)
      const clientEmail = (normalizedClient.email || "").trim().toLowerCase();
      batch.set(
        doc(firestore, "tenants", targetSlug),
        cleanFirestoreData({
          name: normalizedClient.name,
          slug: targetSlug,
          contact: normalizedClient.contact,
          email: normalizedClient.email || "",
          phone: normalizedClient.phone,
          package: normalizedClient.pkg,
          playersLimit: normalizedClient.playersLimit,
          playersCount: 0,
          branchesCount: 0,
          multiBranch: normalizedClient.multiBranch,
          features: normalizedClient.features,
          status: "Setup pending",
          createdAt: normalizedClient.createdAt,
          memberEmails: clientEmail ? [clientEmail] : [],
          roleMap: clientEmail ? { [clientEmail]: "Academy Manager" } : {},
        }),
      );

      // Seed initial Academy Manager user profile if email is provided
      if (clientEmail) {
        batch.set(
          doc(firestore, "tenants", targetSlug, "users", `u-${targetSlug}-manager`),
          {
            id: `u-${targetSlug}-manager`,
            name: normalizedClient.contact || normalizedClient.name,
            email: clientEmail,
            role: "Academy Manager",
            branch: "All",
            branchScope: "All branches",
            active: true,
            method: "Google",
          },
          { merge: true },
        );
      }

      // Provision empty database foundation (settings, appearance, lists)
      const base = emptyDB();
      batch.set(
        doc(firestore, "tenants", targetSlug, "settings", "appearance"),
        cleanFirestoreData(base.appearance),
      );
      batch.set(
        doc(firestore, "tenants", targetSlug, "settings", "lists"),
        cleanFirestoreData(base.lists),
      );

      const auditId = `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      batch.set(doc(firestore, "master_console", "global", "auditLogs", auditId), {
        id: auditId,
        timestamp: new Date().toISOString(),
        actor: currentUser?.email || "master-admin",
        action: `Provisioned workspace (${normalizedClient.pkg})`,
        target: `${normalizedClient.name} (${targetSlug})`,
        severity: "info",
      });

      await batch.commit();
    },
    [currentUser?.email],
  );

  return { clients, tickets, auditLogs, ready, persist, persistTicket, persistAuditLog };
}

export type SetupState = {
  done: boolean;
  academyName: string;
  sport: "Basketball" | "Football" | "Volleyball";
  logo: string | null;
  admins: { email: string; username: string; password: string }[];
};

const getSetupKey = (tenantId?: string) => {
  const tid = normalizeTenantSlug(tenantId || getTenantSlug());
  return `vv-setup-${tid}`;
};

export const emptySetup: SetupState = {
  done: false,
  academyName: "",
  sport: "Basketball",
  logo: null,
  admins: [],
};

export const SETUP_SYNC_EVENT = "vv-setup-sync";

let hasSetupHydrated = false;

export function useSetup(overrideTenantId?: string) {
  const tenantId = normalizeTenantSlug(overrideTenantId || getTenantSlug());

  const getSnapshot = useCallback((): SetupState => {
    if (typeof window === "undefined") return emptySetup;
    try {
      const key = getSetupKey(tenantId);
      const raw = window.localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as SetupState;
      const legacy = window.localStorage.getItem("vv-setup");
      if (legacy && tenantId === DEFAULT_TENANT_SLUG) return JSON.parse(legacy) as SetupState;
    } catch {
      /* ignore */
    }
    return emptySetup;
  }, [tenantId]);

  const [setup, setSetup] = useState<SetupState>(() =>
    hasSetupHydrated ? getSnapshot() : emptySetup,
  );
  const [ready, setReady] = useState<boolean>(() => hasSetupHydrated);

  useEffect(() => {
    hasSetupHydrated = true;
    const syncIfChanged = () => {
      const nextSnap = getSnapshot();
      setSetup((prev) => (JSON.stringify(prev) === JSON.stringify(nextSnap) ? prev : nextSnap));
    };
    syncIfChanged();
    setReady((prev) => (prev ? prev : true));

    window.addEventListener(SETUP_SYNC_EVENT, syncIfChanged);
    window.addEventListener("storage", syncIfChanged);
    return () => {
      window.removeEventListener(SETUP_SYNC_EVENT, syncIfChanged);
      window.removeEventListener("storage", syncIfChanged);
    };
  }, [getSnapshot]);

  const save = useCallback(
    (next: SetupState) => {
      setSetup(next);
      try {
        window.localStorage.setItem(getSetupKey(tenantId), JSON.stringify(next));
        window.dispatchEvent(new Event(SETUP_SYNC_EVENT));
      } catch {
        /* ignore */
      }
    },
    [tenantId],
  );

  return { setup, ready, save };
}

export const slugify = (s: string) =>
  normalizeTenantSlug(
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
  );

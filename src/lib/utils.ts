import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const DEFAULT_TENANT_SLUG = "donbosco";

export function normalizeTenantSlug(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return DEFAULT_TENANT_SLUG;
  const cleaned = raw.trim().toLowerCase();
  if (
    !cleaned ||
    cleaned === "default" ||
    cleaned === "dev-workspace" ||
    cleaned === "dev_workspace" ||
    cleaned === "donboscoacademy" ||
    cleaned === "don-bosco-academy" ||
    cleaned === "don_bosco_academy" ||
    cleaned === "don-bosco" ||
    cleaned === "don_bosco" ||
    cleaned === "vescio-vector" ||
    cleaned === "vesciovector" ||
    cleaned.startsWith("id-preview--") ||
    cleaned.startsWith("ais-dev-") ||
    cleaned.startsWith("ais-pre-") ||
    /^\d+$/.test(cleaned)
  ) {
    return DEFAULT_TENANT_SLUG;
  }
  return cleaned;
}

export function getTenantSlug(): string {
  if (typeof window === "undefined") return DEFAULT_TENANT_SLUG;

  // 1. Explicit query parameter (?tenant=slug)
  try {
    const params = new URLSearchParams(window.location.search);
    const paramTenant = params.get("tenant")?.trim();
    if (paramTenant) {
      const normalized = normalizeTenantSlug(paramTenant);
      window.localStorage.setItem("vv_current_tenant", normalized);
      window.localStorage.setItem("activeTenantSlug", normalized);
      return normalized;
    }
  } catch {
    // ignore search param parsing failure
  }

  // 2. Subdomain detection strictly for multi-tenant .vesciovector.app domains
  const host = window.location.hostname.toLowerCase();
  if (host.includes(".vesciovector.app")) {
    const prefix = host.split(".vesciovector.app")[0];
    const sub = prefix.split(".").pop();
    if (sub && sub !== "www" && sub !== "app" && sub !== "preview") {
      const normalized = normalizeTenantSlug(sub);
      try {
        window.localStorage.setItem("vv_current_tenant", normalized);
        window.localStorage.setItem("activeTenantSlug", normalized);
      } catch {
        // ignore
      }
      return normalized;
    }
  }

  // 3. Fallback for custom domains or preview domains: check localStorage
  try {
    const storedTenant =
      window.localStorage.getItem("vv_current_tenant") ||
      window.localStorage.getItem("activeTenantSlug") ||
      window.localStorage.getItem("vv_tenant_id") ||
      window.localStorage.getItem("vv_tenant_slug") ||
      window.localStorage.getItem("vv_active_tenant");
    if (storedTenant && storedTenant.trim()) {
      const normalized = normalizeTenantSlug(storedTenant);
      if (normalized !== storedTenant.trim()) {
        window.localStorage.setItem("vv_current_tenant", normalized);
        window.localStorage.setItem("activeTenantSlug", normalized);
      }
      return normalized;
    }

    // Check user session for assigned tenant
    const session =
      window.localStorage.getItem("vv_auth_session_user") ||
      window.sessionStorage.getItem("vv_auth_session_user");
    if (session) {
      const parsed = JSON.parse(session);
      if (parsed?.tenantId && typeof parsed.tenantId === "string") {
        const normalized = normalizeTenantSlug(parsed.tenantId);
        window.localStorage.setItem("vv_current_tenant", normalized);
        return normalized;
      }
      if (parsed?.tenantSlug && typeof parsed.tenantSlug === "string") {
        const normalized = normalizeTenantSlug(parsed.tenantSlug);
        window.localStorage.setItem("vv_current_tenant", normalized);
        return normalized;
      }
    }

    // Check existing setup documents in localStorage
    if (window.localStorage.getItem("vv-setup-donbosco")) {
      window.localStorage.setItem("vv_current_tenant", DEFAULT_TENANT_SLUG);
      return DEFAULT_TENANT_SLUG;
    }
  } catch {
    // ignore localStorage access errors
  }

  // 4. Default academy tenant fallback (matching provisioned Firestore /tenants/donbosco database)
  const envDefault = (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_DEFAULT_TENANT;
  const fallbackSlug =
    envDefault && typeof envDefault === "string" && envDefault.trim()
      ? normalizeTenantSlug(envDefault)
      : DEFAULT_TENANT_SLUG;

  try {
    window.localStorage.setItem("vv_current_tenant", fallbackSlug);
    window.localStorage.setItem("activeTenantSlug", fallbackSlug);
  } catch {
    // ignore
  }

  return fallbackSlug;
}

export function setTenantSlug(slug: string): void {
  if (typeof window === "undefined" || !slug) return;
  try {
    const normalized = normalizeTenantSlug(slug);
    window.localStorage.setItem("vv_current_tenant", normalized);
    window.localStorage.setItem("activeTenantSlug", normalized);
  } catch {
    // ignore
  }
}

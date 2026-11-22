import type { DB } from "./data-store";
import type { QueryClient } from "@tanstack/react-query";

export type SliceKey = keyof DB | "ALL";
export type Listener = () => void;

export class ReactiveDBStore {
  private db: DB;
  private sliceListeners = new Map<SliceKey, Set<Listener>>();
  private activeSubscriptions = new Map<keyof DB, () => void>();
  private hydratedSlices = new Set<keyof DB>();
  private activeTenantId: string | null = null;
  private queryClient: QueryClient | null = null;
  private emptyFactory: () => DB;
  private clientCacheHydrated = false;

  constructor(emptyFactory: () => DB) {
    this.emptyFactory = emptyFactory;
    this.db = emptyFactory();
  }

  private getCacheKey(tenantId?: string | null): string {
    return `vv_cache_${tenantId || this.activeTenantId || "donbosco"}`;
  }

  private loadFromLocalCache(tenantId: string): DB {
    const base = this.emptyFactory();
    if (typeof window === "undefined") return base;
    try {
      const raw = window.localStorage.getItem(this.getCacheKey(tenantId));
      if (!raw) return base;
      const parsed = JSON.parse(raw) as Partial<DB>;
      if (!parsed || typeof parsed !== "object") return base;
      return {
        ...base,
        ...parsed,
        academy: parsed.academy ? { ...base.academy, ...parsed.academy } : base.academy,
        appearance: parsed.appearance
          ? { ...base.appearance, ...parsed.appearance }
          : base.appearance,
        lists: parsed.lists ? { ...base.lists, ...parsed.lists } : base.lists,
      };
    } catch {
      return base;
    }
  }

  private saveToLocalCache() {
    if (typeof window === "undefined" || !this.activeTenantId) return;
    try {
      window.localStorage.setItem(this.getCacheKey(this.activeTenantId), JSON.stringify(this.db));
    } catch {
      // Ignore quota errors
    }
  }

  public clearLocalCache(tenantId?: string) {
    if (typeof window === "undefined") return;
    try {
      const target = tenantId || this.activeTenantId || "donbosco";
      window.localStorage.removeItem(this.getCacheKey(target));
      window.localStorage.removeItem(`vv_cache_${target}`);
      window.localStorage.removeItem("vv_cache_donbosco");
    } catch {
      // Ignore
    }
  }

  public clearQueryCache() {
    if (this.queryClient) {
      this.queryClient.clear();
    }
  }

  public setQueryClient(client: QueryClient | null) {
    this.queryClient = client;
  }

  public getDB(): DB {
    return this.db;
  }

  public getSlice<K extends keyof DB>(key: K): DB[K] {
    return this.db[key];
  }

  public subscribe(slice: SliceKey, listener: Listener): () => void {
    if (!this.sliceListeners.has(slice)) {
      this.sliceListeners.set(slice, new Set());
    }
    this.sliceListeners.get(slice)!.add(listener);
    return () => {
      this.sliceListeners.get(slice)?.delete(listener);
    };
  }

  private notify(slices: SliceKey[]) {
    const listenersToCall = new Set<Listener>();
    for (const slice of slices) {
      const set = this.sliceListeners.get(slice);
      if (set) {
        set.forEach((l) => listenersToCall.add(l));
      }
    }
    const allSet = this.sliceListeners.get("ALL");
    if (allSet) {
      allSet.forEach((l) => listenersToCall.add(l));
    }
    listenersToCall.forEach((l) => l());
  }

  public setSlice<K extends keyof DB>(key: K, data: DB[K]) {
    if (this.db[key] === data) return;
    this.db = { ...this.db, [key]: data };
    if (this.queryClient && this.activeTenantId) {
      this.queryClient.setQueryData(["firestore", this.activeTenantId, key], data);
    }
    this.saveToLocalCache();
    this.notify([key]);
  }

  public setWholeDB(nextDB: DB) {
    const changedKeys: (keyof DB)[] = [];
    for (const k of Object.keys(nextDB) as (keyof DB)[]) {
      if (this.db[k] !== nextDB[k]) {
        changedKeys.push(k);
        if (this.queryClient && this.activeTenantId) {
          this.queryClient.setQueryData(["firestore", this.activeTenantId, k], nextDB[k]);
        }
      }
    }
    this.db = nextDB;
    this.saveToLocalCache();
    if (changedKeys.length > 0) {
      this.notify(changedKeys);
    }
  }

  public updateDB(updater: ((prev: DB) => DB) | DB) {
    const next = typeof updater === "function" ? (updater as (prev: DB) => DB)(this.db) : updater;
    this.setWholeDB(next);
  }

  public resetTenant(tenantId: string) {
    if (this.activeTenantId !== tenantId) {
      this.unsubscribeAll();
      this.activeTenantId = tenantId;
      this.db = this.clientCacheHydrated ? this.loadFromLocalCache(tenantId) : this.emptyFactory();
      this.notify(["ALL"]);
    }
  }

  public hydrateFromLocalCache(tenantId?: string) {
    const targetTenant = tenantId || this.activeTenantId || "donbosco";
    if (!this.clientCacheHydrated || this.activeTenantId !== targetTenant) {
      this.clientCacheHydrated = true;
      this.activeTenantId = targetTenant;
      const cached = this.loadFromLocalCache(targetTenant);
      const nextDB: DB = { ...this.db };
      const changedKeys: (keyof DB)[] = [];
      for (const k of Object.keys(cached) as (keyof DB)[]) {
        if (!this.hydratedSlices.has(k) && nextDB[k] !== cached[k]) {
          (nextDB as Record<keyof DB, unknown>)[k] = cached[k];
          changedKeys.push(k);
        }
      }
      this.db = nextDB;
      if (changedKeys.length > 0) {
        this.notify(changedKeys);
      }
    }
  }

  public getActiveTenant(): string | null {
    return this.activeTenantId;
  }

  public markHydrated(key: keyof DB) {
    this.hydratedSlices.add(key);
  }

  public isHydrated(key: keyof DB): boolean {
    return this.hydratedSlices.has(key);
  }

  public unsubscribeAll() {
    this.activeSubscriptions.forEach((unsub) => {
      try {
        unsub();
      } catch {
        /* ignore */
      }
    });
    this.activeSubscriptions.clear();
    this.hydratedSlices.clear();
  }

  public isSubscribed(key: keyof DB): boolean {
    return this.activeSubscriptions.has(key);
  }

  public registerSubscription(key: keyof DB, unsub: () => void) {
    if (this.activeSubscriptions.has(key)) {
      try {
        this.activeSubscriptions.get(key)!();
      } catch {
        /* ignore */
      }
    }
    this.activeSubscriptions.set(key, unsub);
  }

  public unregisterSubscription(key: keyof DB) {
    if (this.activeSubscriptions.has(key)) {
      try {
        this.activeSubscriptions.get(key)!();
      } catch {
        /* ignore */
      }
      this.activeSubscriptions.delete(key);
    }
    this.hydratedSlices.delete(key);
  }
}

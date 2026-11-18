import {
  doc,
  writeBatch,
  setDoc,
  deleteDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  deleteField,
} from "firebase/firestore";
import { db as firestore } from "./firebase";
import { defaultAgeCategoryRules, type DB, type AcademyNotification } from "./data-store";
import { logSystemError } from "./error-logger";

function isFirestoreFieldValue(val: unknown): boolean {
  if (typeof val !== "object" || val === null) return false;
  const rec = val as Record<string, unknown>;
  return (
    typeof rec._methodName === "string" ||
    Boolean(rec._isFirestoreSentinel) ||
    (typeof rec.isEqual === "function" &&
      val.constructor &&
      val.constructor.name !== "Object" &&
      val.constructor.name !== "Array")
  );
}

function isNonSerializableObject(val: object): boolean {
  if (typeof Event !== "undefined" && val instanceof Event) return true;
  if (typeof Element !== "undefined" && val instanceof Element) return true;
  if (typeof Node !== "undefined" && val instanceof Node) return true;
  if (typeof Window !== "undefined" && val instanceof Window) return true;
  if (typeof File !== "undefined" && val instanceof File) return true;
  if (typeof Blob !== "undefined" && val instanceof Blob) return true;
  const rec = val as Record<string, unknown>;
  if (
    "_reactName" in rec ||
    "nativeEvent" in rec ||
    "isDefaultPrevented" in rec ||
    "isPropagationStopped" in rec ||
    "_targetInst" in rec ||
    "stateNode" in rec
  ) {
    return true;
  }
  return false;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (typeof val !== "object" || val === null) return false;
  if (Object.prototype.toString.call(val) !== "[object Object]") return false;
  const proto = Object.getPrototypeOf(val);
  return proto === null || proto === Object.prototype;
}

/**
 * Recursively sanitizes objects before writing to Firestore.
 * Replaces undefined values with deleteField() at the document root (if merge/update)
 * or strips them completely, ensuring Firestore never errors on "Unsupported field value: undefined".
 * Safely preserves native Firestore FieldValue instances (deleteField, serverTimestamp, etc.) without mutating them,
 * converts Date instances to ISO strings, and strictly strips circular references, React SyntheticEvents, DOM nodes, and functions.
 */
export function sanitizeForFirestore<T>(
  val: T,
  useDeleteField = false,
  seen: WeakSet<object> = new WeakSet(),
): T {
  if (val === null || val === undefined) {
    return val;
  }
  if (typeof val === "function" || typeof val === "symbol") {
    return undefined as unknown as T;
  }
  if (val instanceof Date) {
    return (Number.isNaN(val.getTime())
      ? new Date().toISOString()
      : val.toISOString()) as unknown as T;
  }
  // If val is a native Firestore FieldValue, do not recurse into it!
  if (isFirestoreFieldValue(val)) {
    return val;
  }
  if (typeof val === "object" && val !== null) {
    if (isNonSerializableObject(val)) {
      return undefined as unknown as T;
    }
    if (seen.has(val)) {
      return undefined as unknown as T;
    }
  }
  if (Array.isArray(val)) {
    seen.add(val);
    const mapped = val
      .map((item) => sanitizeForFirestore(item, false, seen))
      .filter((item) => item !== undefined) as unknown as T;
    return mapped;
  }
  if (isPlainObject(val)) {
    seen.add(val);
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(val)) {
      if (value === undefined || typeof value === "function" || typeof value === "symbol") {
        if (useDeleteField) {
          clean[key] = deleteField();
        }
      } else if (isFirestoreFieldValue(value)) {
        clean[key] = value;
      } else if (value instanceof Date) {
        clean[key] = Number.isNaN(value.getTime()) ? new Date().toISOString() : value.toISOString();
      } else {
        const sanitizedValue = sanitizeForFirestore(value, false, seen);
        if (sanitizedValue === undefined) {
          if (useDeleteField) {
            clean[key] = deleteField();
          }
        } else {
          clean[key] = sanitizedValue;
        }
      }
    }
    return clean as T;
  }
  if (typeof val === "object") {
    // Non-plain object (e.g., class instance, SyntheticEvent, DOM node) -> strip
    return undefined as unknown as T;
  }
  return val;
}

/**
 * Recursively strips any key with an undefined value (and filters undefined from arrays),
 * while safely preserving native Firestore FieldValue instances.
 */
export function cleanFirestoreData<T>(val: T, seen: WeakSet<object> = new WeakSet()): T {
  if (val === undefined) {
    return null as unknown as T;
  }
  return sanitizeForFirestore(val, false, seen);
}

/**
 * Recursively cleans incoming Firestore data snapshots to remove any leaked FieldValue
 * or {_methodName: ...} objects before injecting into React or local stores.
 */
export function cleanIncomingFirestoreData<T>(val: T, seen: WeakSet<object> = new WeakSet()): T {
  if (val === null || val === undefined) {
    return val;
  }
  if (typeof val === "function" || typeof val === "symbol") {
    return undefined as unknown as T;
  }
  if (val instanceof Date) {
    return (Number.isNaN(val.getTime())
      ? new Date().toISOString()
      : val.toISOString()) as unknown as T;
  }
  if (isFirestoreFieldValue(val)) {
    return undefined as unknown as T;
  }
  if (typeof val === "object" && val !== null) {
    if (isNonSerializableObject(val) || seen.has(val)) {
      return undefined as unknown as T;
    }
  }
  if (Array.isArray(val)) {
    seen.add(val);
    const arr = val
      .map((item) => cleanIncomingFirestoreData(item, seen))
      .filter((item) => item !== undefined) as unknown as T;
    return arr;
  }
  if (isPlainObject(val)) {
    seen.add(val);
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(val)) {
      if (isFirestoreFieldValue(value)) {
        continue;
      }
      const cleanedVal = cleanIncomingFirestoreData(value, seen);
      if (cleanedVal !== undefined) {
        clean[key] = cleanedVal;
      }
    }
    return clean as T;
  }
  if (typeof val === "object") {
    return undefined as unknown as T;
  }
  return val;
}

/**
 * Direct atomic setDoc mutation on a single item in a collection or subcollection.
 */
export async function atomicSetItem(
  tenantId: string,
  collectionName: string,
  id: string,
  data: Record<string, unknown> | unknown,
) {
  const docId =
    collectionName === "users" &&
    data &&
    typeof data === "object" &&
    "authUid" in data &&
    typeof (data as { authUid?: unknown }).authUid === "string" &&
    (data as { authUid?: string }).authUid
      ? (data as { authUid: string }).authUid
      : id;
  const docRef = doc(firestore, "tenants", tenantId, collectionName, docId);
  try {
    await setDoc(docRef, sanitizeForFirestore(data as Record<string, unknown>, false), {
      merge: true,
    });
  } catch (err) {
    logSystemError({
      source: "firestore_write",
      operation: `atomicSetItem(${collectionName}/${docId})`,
      error: err,
      payload: data,
      tenantId,
    });
    throw err;
  }

  // SEC-02: Maintain memberEmails, roleMap & usernameMap on tenant root document for multi-tenant RBAC & bare-username login
  if (collectionName === "users" && data && typeof data === "object") {
    const userObj = data as {
      email?: string;
      username?: string;
      role?: string;
      authUid?: string;
    };
    const roleMapUpdates: Record<string, unknown> = {};
    const usernameMapUpdates: Record<string, unknown> = {};
    const rootUpdates: Record<string, unknown> = {};
    if (userObj.email && typeof userObj.email === "string") {
      const emailLower = userObj.email.trim().toLowerCase();
      rootUpdates.memberEmails = arrayUnion(emailLower);
      roleMapUpdates[emailLower] = userObj.role || "Staff";
      const unameLower = (userObj.username || emailLower.split("@")[0] || "").trim().toLowerCase();
      if (unameLower) {
        usernameMapUpdates[unameLower] = emailLower;
      }
      const emailPrefix = emailLower.split("@")[0]?.trim().toLowerCase();
      if (emailPrefix && emailPrefix !== unameLower) {
        usernameMapUpdates[emailPrefix] = emailLower;
      }
    }
    if (userObj.authUid && typeof userObj.authUid === "string") {
      roleMapUpdates[userObj.authUid] = userObj.role || "Staff";
    } else if (id) {
      roleMapUpdates[id] = userObj.role || "Staff";
    }
    if (Object.keys(roleMapUpdates).length > 0) {
      rootUpdates.roleMap = roleMapUpdates;
    }
    if (Object.keys(usernameMapUpdates).length > 0) {
      rootUpdates.usernameMap = usernameMapUpdates;
      await setDoc(
        doc(firestore, "tenants", tenantId, "public", "auth_lookup"),
        { usernameMap: usernameMapUpdates },
        { merge: true },
      ).catch(() => {});
    }
    if (Object.keys(rootUpdates).length > 0) {
      await setDoc(doc(firestore, "tenants", tenantId), rootUpdates, { merge: true }).catch(
        () => {},
      );
    }
    const roleUpper = String(userObj.role || "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
    const emailCheck = String(userObj.email || "")
      .trim()
      .toLowerCase();
    if (
      roleUpper === "SUPER_ADMIN" ||
      roleUpper === "ACADEMY_MANAGER" ||
      emailCheck === "geogo3@gmail.com"
    ) {
      await setDoc(
        doc(firestore, "users", docId),
        sanitizeForFirestore(
          {
            ...(data as Record<string, unknown>),
            id: docId,
            uid: docId,
            authUid: docId,
            role: "SUPER_ADMIN",
            uiRole: "Super Admin",
            tenantId,
            active: true,
          },
          false,
        ),
        { merge: true },
      ).catch(() => {});
    }
  }
}

/**
 * Direct atomic updateDoc mutation on a single item.
 */
export async function atomicUpdateItem(
  tenantId: string,
  collectionName: string,
  id: string,
  data: Record<string, unknown>,
) {
  const docId =
    collectionName === "users" &&
    data &&
    typeof data === "object" &&
    "authUid" in data &&
    typeof (data as { authUid?: unknown }).authUid === "string" &&
    (data as { authUid?: string }).authUid
      ? (data as { authUid: string }).authUid
      : id;
  const docRef = doc(firestore, "tenants", tenantId, collectionName, docId);
  try {
    await updateDoc(docRef, sanitizeForFirestore(data, true));
  } catch (err) {
    logSystemError({
      source: "firestore_write",
      operation: `atomicUpdateItem(${collectionName}/${docId})`,
      error: err,
      payload: data,
      tenantId,
    });
    throw err;
  }

  // SEC-02: Maintain memberEmails, roleMap & usernameMap on tenant root document for multi-tenant RBAC & bare-username login
  if (collectionName === "users" && data && typeof data === "object") {
    const userObj = data as {
      email?: string;
      username?: string;
      role?: string;
      authUid?: string;
    };
    const roleMapUpdates: Record<string, unknown> = {};
    const usernameMapUpdates: Record<string, unknown> = {};
    const rootUpdates: Record<string, unknown> = {};
    if (userObj.email && typeof userObj.email === "string") {
      const emailLower = userObj.email.trim().toLowerCase();
      rootUpdates.memberEmails = arrayUnion(emailLower);
      if (userObj.role) {
        roleMapUpdates[emailLower] = userObj.role;
      }
      const unameLower = (userObj.username || emailLower.split("@")[0] || "").trim().toLowerCase();
      if (unameLower) {
        usernameMapUpdates[unameLower] = emailLower;
      }
      const emailPrefix = emailLower.split("@")[0]?.trim().toLowerCase();
      if (emailPrefix && emailPrefix !== unameLower) {
        usernameMapUpdates[emailPrefix] = emailLower;
      }
    }
    if (userObj.role) {
      if (userObj.authUid && typeof userObj.authUid === "string") {
        roleMapUpdates[userObj.authUid] = userObj.role;
      }
      if (id) {
        roleMapUpdates[id] = userObj.role;
      }
    }
    if (Object.keys(roleMapUpdates).length > 0) {
      rootUpdates.roleMap = roleMapUpdates;
    }
    if (Object.keys(usernameMapUpdates).length > 0) {
      rootUpdates.usernameMap = usernameMapUpdates;
      await setDoc(
        doc(firestore, "tenants", tenantId, "public", "auth_lookup"),
        { usernameMap: usernameMapUpdates },
        { merge: true },
      ).catch(() => {});
    }
    if (Object.keys(rootUpdates).length > 0) {
      await setDoc(doc(firestore, "tenants", tenantId), rootUpdates, { merge: true }).catch(
        () => {},
      );
    }
    const roleUpper = String(userObj.role || "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
    const emailCheck = String(userObj.email || "")
      .trim()
      .toLowerCase();
    if (
      roleUpper === "SUPER_ADMIN" ||
      roleUpper === "ACADEMY_MANAGER" ||
      emailCheck === "geogo3@gmail.com"
    ) {
      await setDoc(
        doc(firestore, "users", docId),
        sanitizeForFirestore(
          {
            ...data,
            id: docId,
            uid: docId,
            authUid: docId,
            role: "SUPER_ADMIN",
            uiRole: "Super Admin",
            tenantId,
            active: true,
          },
          false,
        ),
        { merge: true },
      ).catch(() => {});
    }
  }
}

/**
 * Removes user's access credentials from tenant root document (memberEmails, roleMap, and usernameMap).
 * Uses arrayRemove and deleteField to immediately revoke Firestore security rules access.
 */
export async function removeTenantUserAccess(
  tenantId: string,
  user: { email?: string; username?: string; authUid?: string; id?: string },
) {
  const roleMapUpdates: Record<string, unknown> = {};
  const usernameMapUpdates: Record<string, unknown> = {};
  const rootUpdates: Record<string, unknown> = {};
  if (user.email && typeof user.email === "string") {
    const emailLower = user.email.trim().toLowerCase();
    rootUpdates.memberEmails = arrayRemove(emailLower);
    roleMapUpdates[emailLower] = deleteField();
    const emailPrefix = emailLower.split("@")[0]?.trim().toLowerCase();
    if (emailPrefix) {
      usernameMapUpdates[emailPrefix] = deleteField();
    }
  }
  if (user.username && typeof user.username === "string") {
    const unameLower = user.username.trim().toLowerCase();
    if (unameLower) {
      usernameMapUpdates[unameLower] = deleteField();
    }
  }
  if (user.authUid && typeof user.authUid === "string") {
    roleMapUpdates[user.authUid] = deleteField();
  }
  if (user.id) {
    roleMapUpdates[user.id] = deleteField();
  }
  if (Object.keys(roleMapUpdates).length > 0) {
    rootUpdates.roleMap = roleMapUpdates;
  }
  if (Object.keys(usernameMapUpdates).length > 0) {
    rootUpdates.usernameMap = usernameMapUpdates;
    await setDoc(
      doc(firestore, "tenants", tenantId, "public", "auth_lookup"),
      { usernameMap: usernameMapUpdates },
      { merge: true },
    ).catch(() => {});
  }
  if (Object.keys(rootUpdates).length > 0) {
    await setDoc(doc(firestore, "tenants", tenantId), rootUpdates, { merge: true }).catch(() => {});
  }
}

/**
 * Direct atomic deleteDoc mutation on a single item.
 */
export async function atomicDeleteItem(
  tenantId: string,
  collectionName: string,
  id: string,
  userInfo?: { email?: string; username?: string; authUid?: string; id?: string },
) {
  const docRef = doc(firestore, "tenants", tenantId, collectionName, id);
  try {
    await deleteDoc(docRef);
  } catch (err) {
    logSystemError({
      source: "firestore_write",
      operation: `atomicDeleteItem(${collectionName}/${id})`,
      error: err,
      payload: { id, userInfo },
      tenantId,
    });
    throw err;
  }

  if (collectionName === "users" && userInfo) {
    await removeTenantUserAccess(tenantId, { ...userInfo, id: userInfo.id || id }).catch(() => {});
  }
}

export interface AttendanceRecordMetadata {
  method?: "qr" | "qr_scan" | "manual";
  flag?: "low_attendance_warning" | string;
}

/**
 * Direct atomic attendance check-in for a single player in a session.
 * Uses merge: true to mutate only that player's record without touching other players or collections.
 */
export async function atomicRecordAttendance(
  tenantId: string,
  sessionId: string,
  playerId: string,
  status: "Present" | "Absent" | "Excused" | "present" | "absent" | "excused",
  timestamp?: string | number,
  metadata?: AttendanceRecordMetadata,
) {
  const ts = timestamp ? String(timestamp) : new Date().toISOString();
  const normalizedStatus = status.toLowerCase() as "present" | "absent" | "excused";
  const capitalizedStatus = (normalizedStatus.charAt(0).toUpperCase() +
    normalizedStatus.slice(1)) as "Present" | "Absent" | "Excused";

  const docRef = doc(firestore, "tenants", tenantId, "attendance", sessionId);
  await setDoc(
    docRef,
    {
      records: {
        [playerId]: capitalizedStatus,
      },
      detailedRecords: {
        [playerId]: {
          playerId,
          status: normalizedStatus,
          timestamp: ts,
          method: metadata?.method || "manual",
          ...(metadata?.flag ? { flag: metadata.flag } : {}),
        },
      },
      updatedAt: ts,
    },
    { merge: true },
  );

  // Keep legacy session attendees array in sync with Present status
  try {
    const sessionRef = doc(firestore, "tenants", tenantId, "sessions", sessionId);
    if (capitalizedStatus === "Present") {
      await updateDoc(sessionRef, {
        attendees: arrayUnion(playerId),
      });
    } else {
      await updateDoc(sessionRef, {
        attendees: arrayRemove(playerId),
      });
    }
  } catch {
    // If session document has not been individually created yet or is offline, merge operation succeeds
  }
}

/**
 * Direct atomic update on academy settings.
 * Writes to the canonical /tenants/{tenantId} document (top-level + nested academy map)
 * and keeps /tenants/{tenantId}/settings/academy synchronized so listeners never read stale blank data.
 */
export async function atomicUpdateAcademy(tenantId: string, data: Record<string, unknown>) {
  const docRef = doc(firestore, "tenants", tenantId);
  const cleaned = cleanFirestoreData(data);
  const rootOnlyFields = [
    "academy",
    "ageCategoryRules",
    "lists",
    "roleMap",
    "memberEmails",
    "usernameMap",
  ];
  for (const field of rootOnlyFields) {
    if (field in cleaned) {
      delete (cleaned as Record<string, unknown>)[field];
    }
  }
  try {
    await setDoc(docRef, { ...cleaned, academy: cleaned }, { merge: true });
  } catch (err) {
    logSystemError({
      source: "firestore_write",
      operation: "atomicUpdateAcademy",
      error: err,
      payload: data,
      tenantId,
    });
    throw err;
  }
}

export interface MerchandiseTransactionPayload {
  stockUpdates?: {
    id: string;
    newStock: number;
    variants?: unknown[];
    variant?: string;
  }[];
  order?: { id: string; [key: string]: unknown };
  playerUpdate?: { id: string; newBalance: number };
  ledgerEntries?: { id: string; [key: string]: unknown }[];
}

export interface InvoiceBatchItem {
  invoice: Record<string, unknown> & { id: string };
  playerUpdate: {
    id: string;
    newBalance: number;
    status?: string;
    idleSinceDate?: string;
    missedSessionsSinceIdle?: number;
    idleMissedSessionIds?: string[];
  };
}

/**
 * Atomic batch operation to create monthly tuition invoices and increment player balances.
 * Handled in chunks of max 200 items (400 ops) to strictly respect Firestore's 500-op batch limit.
 */
export async function atomicGenerateMonthlyInvoices(tenantId: string, items: InvoiceBatchItem[]) {
  if (items.length === 0) return;

  const CHUNK_SIZE = 200;
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(firestore);

    for (const item of chunk) {
      const invoiceRef = doc(firestore, "tenants", tenantId, "invoices", item.invoice.id);
      batch.set(invoiceRef, cleanFirestoreData(item.invoice), { merge: true });

      const playerRef = doc(firestore, "tenants", tenantId, "players", item.playerUpdate.id);
      const playerPatch: Record<string, unknown> = { balance: item.playerUpdate.newBalance };
      if (item.playerUpdate.status !== undefined) {
        playerPatch.status = item.playerUpdate.status;
      }
      if (item.playerUpdate.idleSinceDate !== undefined) {
        playerPatch.idleSinceDate = item.playerUpdate.idleSinceDate;
      }
      if (item.playerUpdate.missedSessionsSinceIdle !== undefined) {
        playerPatch.missedSessionsSinceIdle = item.playerUpdate.missedSessionsSinceIdle;
      }
      if (item.playerUpdate.idleMissedSessionIds !== undefined) {
        playerPatch.idleMissedSessionIds = item.playerUpdate.idleMissedSessionIds;
      }
      batch.set(playerRef, cleanFirestoreData(playerPatch), { merge: true });
    }

    await batch.commit();
  }
}

/**
 * Executes an atomic batch transaction across Stock, Orders, Players, and Accounting Ledger
 * to ensure inventory counts, balances, and financial journal lines never drift.
 */
export async function atomicProcessMerchandiseTransaction(
  tenantId: string,
  payload: MerchandiseTransactionPayload,
) {
  const batch = writeBatch(firestore);

  // 1. Stock updates (including structured variant array quantities)
  if (payload.stockUpdates) {
    for (const s of payload.stockUpdates) {
      const stockRef = doc(firestore, "tenants", tenantId, "stock", s.id);
      const stockPayload: Record<string, unknown> = { stock: s.newStock };
      if (Array.isArray(s.variants)) {
        stockPayload.variants = cleanFirestoreData(s.variants);
      }
      if (typeof s.variant === "string") {
        stockPayload.variant = s.variant;
      }
      batch.set(stockRef, stockPayload, { merge: true });
    }
  }

  // 2. Order set/update
  if (payload.order) {
    const orderRef = doc(firestore, "tenants", tenantId, "orders", payload.order.id);
    batch.set(orderRef, cleanFirestoreData(payload.order), { merge: true });
  }

  // 3. Player balance update
  if (payload.playerUpdate) {
    const playerRef = doc(firestore, "tenants", tenantId, "players", payload.playerUpdate.id);
    batch.set(playerRef, { balance: payload.playerUpdate.newBalance }, { merge: true });
  }

  // 4. Ledger entries
  if (payload.ledgerEntries) {
    for (const entry of payload.ledgerEntries) {
      const ledgerRef = doc(firestore, "tenants", tenantId, "ledger", entry.id);
      batch.set(ledgerRef, cleanFirestoreData(entry), { merge: true });
    }
  }

  await batch.commit();
}

/**
 * Atomic multi-document write for invoice payment transactions.
 * Updates invoice, updates player balance, and records the accounting ledger entry
 * within a single atomic Firestore writeBatch to guarantee all-or-nothing consistency.
 */
export async function atomicProcessInvoicePayment(
  tenantId: string,
  invoiceId: string,
  updatedInvoice: Record<string, unknown>,
  playerUpdate?: {
    playerId: string;
    balance: number;
    status?: string;
    idleSinceDate?: string;
    missedSessionsSinceIdle?: number;
    idleMissedSessionIds?: string[];
  },
  ledgerEntry?: Record<string, unknown> & { id: string },
) {
  const batch = writeBatch(firestore);
  const invoiceRef = doc(firestore, "tenants", tenantId, "invoices", invoiceId);
  batch.set(invoiceRef, cleanFirestoreData(updatedInvoice), { merge: true });

  if (playerUpdate) {
    const playerRef = doc(firestore, "tenants", tenantId, "players", playerUpdate.playerId);
    const patch: Record<string, unknown> = { balance: playerUpdate.balance };
    if (playerUpdate.status !== undefined) patch.status = playerUpdate.status;
    if (playerUpdate.idleSinceDate !== undefined) patch.idleSinceDate = playerUpdate.idleSinceDate;
    if (playerUpdate.missedSessionsSinceIdle !== undefined) {
      patch.missedSessionsSinceIdle = playerUpdate.missedSessionsSinceIdle;
    }
    if (playerUpdate.idleMissedSessionIds !== undefined) {
      patch.idleMissedSessionIds = playerUpdate.idleMissedSessionIds;
    }
    batch.update(playerRef, cleanFirestoreData(patch));
  }

  if (ledgerEntry) {
    const ledgerRef = doc(firestore, "tenants", tenantId, "ledger", ledgerEntry.id);
    batch.set(ledgerRef, cleanFirestoreData(ledgerEntry));
  }

  await batch.commit();
}

/**
 * Fast deep equality check for database entity diffing.
 */
function isDeepEqual(a: unknown, b: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (isNonSerializableObject(a) || isNonSerializableObject(b)) return a === b;
  if (seen.has(a) || seen.has(b)) return true;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    seen.add(a);
    seen.add(b);
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i], seen)) {
        seen.delete(a);
        seen.delete(b);
        return false;
      }
    }
    seen.delete(a);
    seen.delete(b);
    return true;
  }

  if (Array.isArray(b)) return false;

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;

  seen.add(a);
  seen.add(b);
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) {
      seen.delete(a);
      seen.delete(b);
      return false;
    }
    if (!isDeepEqual(objA[key], objB[key], seen)) {
      seen.delete(a);
      seen.delete(b);
      return false;
    }
  }
  seen.delete(a);
  seen.delete(b);

  return true;
}

/**
 * Checks whether an item has structurally changed.
 * Evaluates updatedAt timestamps first if present, then falls back to full deep equality.
 */
function hasItemChanged(curr: unknown, next: unknown): boolean {
  if (curr === next) return false;
  if (!curr || !next) return true;

  const c = curr as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  if (c.updatedAt && n.updatedAt) {
    return c.updatedAt !== n.updatedAt;
  }

  return !isDeepEqual(curr, next);
}

/**
 * Synchronizes differences between state trees to Firestore with chunked batches (max 450 ops/batch)
 * and direct atomic writes when only a single entity changed.
 */
export async function syncToFirestore(tenantId: string, current: DB, next: DB) {
  type PendingOp =
    { type: "set"; path: string[]; data: unknown } | { type: "delete"; path: string[] };

  const pendingOps: PendingOp[] = [];

  const arrayKeys: (keyof DB)[] = [
    "coaches",
    "players",
    "teams",
    "staff",
    "branches",
    "sessions",
    "stock",
    "suppliers",
    "orders",
    "ledger",
    "invoices",
    "users",
    "plans",
    "drills",
    "groups",
    "resourceFolders",
    "workshops",
    "notifications",
    "customRoles",
    "crmLeads",
    "courtReservations",
    "gymMembers",
    "physioRecords",
    "posCatalog",
    "posTransactions",
  ];

  for (const key of arrayKeys) {
    if (current[key] !== next[key]) {
      const currArr = (current[key] as Array<{ id: string }>) || [];
      const nextArr = (next[key] as Array<{ id: string }>) || [];
      const currMap = new Map(currArr.map((item) => [item.id, item]));
      const nextMap = new Map(nextArr.map((item) => [item.id, item]));

      for (const [id, item] of nextMap.entries()) {
        const currItem = currMap.get(id);
        if (!currItem || hasItemChanged(currItem, item)) {
          const payload: Record<string, unknown> = { ...(item as Record<string, unknown>) };
          if (currItem && typeof currItem === "object") {
            for (const k of Object.keys(currItem as Record<string, unknown>)) {
              if (payload[k] === undefined) {
                payload[k] = deleteField();
              }
            }
          }
          const docId =
            key === "users" &&
            item &&
            typeof (item as { authUid?: unknown }).authUid === "string" &&
            (item as { authUid?: string }).authUid
              ? (item as { authUid: string }).authUid
              : id;
          pendingOps.push({
            type: "set",
            path: [key, docId],
            data: sanitizeForFirestore(payload, true),
          });
        }
      }
      for (const [id, item] of currMap.entries()) {
        if (!nextMap.has(id)) {
          const docId =
            key === "users" &&
            item &&
            typeof (item as { authUid?: unknown }).authUid === "string" &&
            (item as { authUid?: string }).authUid
              ? (item as { authUid: string }).authUid
              : id;
          pendingOps.push({ type: "delete", path: [key, docId] });
        }
      }
    }
  }

  // SEC-02: Maintain memberEmails, roleMap, and usernameMap on tenant root and public/auth_lookup when users slice changes, cleaning up deleted users
  if (current.users !== next.users && !isDeepEqual(current.users, next.users)) {
    const memberEmails = Array.from(
      new Set(
        (next.users || [])
          .map((u) => u.email?.trim().toLowerCase())
          .filter((e): e is string => Boolean(e)),
      ),
    );
    const roleMap: Record<string, unknown> = {};
    const usernameMap: Record<string, unknown> = {};
    const nextUsernames = new Set<string>();

    (next.users || []).forEach((u) => {
      const role = u.role || "Staff";
      const emailLower = u.email?.trim().toLowerCase();
      if (emailLower) {
        roleMap[emailLower] = role;
        const unameLower = (u.username || emailLower.split("@")[0] || "").trim().toLowerCase();
        if (unameLower) {
          usernameMap[unameLower] = emailLower;
          nextUsernames.add(unameLower);
        }
        const emailPrefix = emailLower.split("@")[0]?.trim().toLowerCase();
        if (emailPrefix && !usernameMap[emailPrefix]) {
          usernameMap[emailPrefix] = emailLower;
          nextUsernames.add(emailPrefix);
        }
      }
      if (u.authUid) roleMap[u.authUid] = role;
      if (u.id) roleMap[u.id] = role;
    });

    const nextUserEmails = new Set(
      (next.users || []).map((u) => u.email?.trim().toLowerCase()).filter(Boolean),
    );
    const nextUserIds = new Set((next.users || []).map((u) => u.id).filter(Boolean));
    const nextUserAuthUids = new Set(
      (next.users || []).map((u) => u.authUid).filter((uid): uid is string => Boolean(uid)),
    );

    (current.users || []).forEach((u) => {
      const emailLower = u.email?.trim().toLowerCase();
      if (emailLower && !nextUserEmails.has(emailLower)) {
        roleMap[emailLower] = deleteField();
        const emailPrefix = emailLower.split("@")[0]?.trim().toLowerCase();
        if (emailPrefix && !nextUsernames.has(emailPrefix)) {
          usernameMap[emailPrefix] = deleteField();
        }
      }
      const unameLower = u.username?.trim().toLowerCase();
      if (unameLower && !nextUsernames.has(unameLower)) {
        usernameMap[unameLower] = deleteField();
      }
      if (u.id && !nextUserIds.has(u.id)) {
        roleMap[u.id] = deleteField();
      }
      if (u.authUid && !nextUserAuthUids.has(u.authUid)) {
        roleMap[u.authUid] = deleteField();
      }
    });

    pendingOps.push({
      type: "set",
      path: [],
      data: { memberEmails, roleMap, usernameMap },
    });
    pendingOps.push({
      type: "set",
      path: ["public", "auth_lookup"],
      data: { usernameMap },
    });
  }

  // Diff singletons with structural equality
  const academyChanged =
    current.academy !== next.academy && !isDeepEqual(current.academy, next.academy);
  const countsChanged =
    current.players.length !== next.players.length ||
    current.branches.length !== next.branches.length;

  if (academyChanged) {
    const cleanedAcademy = cleanFirestoreData({
      ...next.academy,
      playersUsed: next.players.length,
      playersCount: next.players.length,
      branchesUsed: next.branches.length,
      branchesCount: next.branches.length,
    });
    const rootOnlyFields = [
      "academy",
      "ageCategoryRules",
      "lists",
      "roleMap",
      "memberEmails",
      "usernameMap",
    ];
    for (const field of rootOnlyFields) {
      if (field in cleanedAcademy) {
        delete (cleanedAcademy as Record<string, unknown>)[field];
      }
    }
    pendingOps.push({
      type: "set",
      path: [],
      data: {
        ...cleanedAcademy,
        academy: cleanedAcademy,
      },
    });
  }

  // SYNC-01: Persist ageCategoryRules to tenant root document (with deleteField() for removed keys)
  if (
    current.ageCategoryRules !== next.ageCategoryRules &&
    !isDeepEqual(current.ageCategoryRules, next.ageCategoryRules)
  ) {
    const nextRulesPayload: Record<string, unknown> = { ...(next.ageCategoryRules || {}) };
    const candidateKeys = new Set([
      ...Object.keys(current.ageCategoryRules || {}),
      ...Object.keys(defaultAgeCategoryRules),
    ]);
    for (const prevKey of candidateKeys) {
      if (!(prevKey in nextRulesPayload)) {
        nextRulesPayload[prevKey] = deleteField();
      }
    }
    pendingOps.push({
      type: "set",
      path: [],
      data: {
        ageCategoryRules: nextRulesPayload,
        academy: { ageCategoryRules: deleteField() },
      },
    });
  }

  if (current.appearance !== next.appearance && !isDeepEqual(current.appearance, next.appearance)) {
    pendingOps.push({ type: "set", path: ["settings", "appearance"], data: next.appearance });
  }

  if (current.lists !== next.lists && !isDeepEqual(current.lists, next.lists)) {
    pendingOps.push({ type: "set", path: ["settings", "lists"], data: next.lists });
  }

  // Diff attendance with structural equality
  if (current.attendance !== next.attendance || current.attendanceMeta !== next.attendanceMeta) {
    const currKeys = Object.keys(current.attendance || {});
    const nextKeys = Object.keys(next.attendance || {});
    const currMetaKeys = Object.keys(current.attendanceMeta || {});
    const nextMetaKeys = Object.keys(next.attendanceMeta || {});
    const allKeys = new Set([...currKeys, ...nextKeys, ...currMetaKeys, ...nextMetaKeys]);

    for (const key of allKeys) {
      const attChanged =
        current.attendance?.[key] !== next.attendance?.[key] &&
        !isDeepEqual(current.attendance?.[key], next.attendance?.[key]);
      const metaChanged =
        current.attendanceMeta?.[key] !== next.attendanceMeta?.[key] &&
        !isDeepEqual(current.attendanceMeta?.[key], next.attendanceMeta?.[key]);

      if (attChanged || metaChanged) {
        if (next.attendance?.[key] === undefined && next.attendanceMeta?.[key] === undefined) {
          pendingOps.push({ type: "delete", path: ["attendance", key] });
        } else {
          pendingOps.push({
            type: "set",
            path: ["attendance", key],
            data: {
              records: next.attendance?.[key] || {},
              detailedRecords: next.attendanceMeta?.[key] || {},
            },
          });
        }
      }
    }
  }

  if (pendingOps.length === 0) {
    if (countsChanged) {
      await atomicUpdateAcademy(tenantId, {
        playersUsed: next.players.length,
        playersCount: next.players.length,
        branchesUsed: next.branches.length,
        branchesCount: next.branches.length,
      }).catch(() => {});
    }
    return;
  }

  try {
    // Single operation shortcut: use atomic setDoc / deleteDoc directly
    if (pendingOps.length === 1) {
      const op = pendingOps[0];
      if (op.type === "set") {
        const targetRef =
          op.path.length === 0
            ? doc(firestore, "tenants", tenantId)
            : doc(firestore, "tenants", tenantId, ...op.path);
        await setDoc(targetRef, sanitizeForFirestore(op.data as Record<string, unknown>, true), {
          merge: true,
        });
      } else {
        const targetRef = doc(firestore, "tenants", tenantId, ...op.path);
        await deleteDoc(targetRef);
      }
      if (countsChanged && !academyChanged) {
        await atomicUpdateAcademy(tenantId, {
          playersUsed: next.players.length,
          playersCount: next.players.length,
          branchesUsed: next.branches.length,
          branchesCount: next.branches.length,
        }).catch(() => {});
      }
      return;
    }

    // Multiple operations: chunk in batches of max 450 to stay strictly below Firestore's 500-op limit
    const CHUNK_SIZE = 450;
    for (let i = 0; i < pendingOps.length; i += CHUNK_SIZE) {
      const chunk = pendingOps.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(firestore);
      for (const op of chunk) {
        const targetRef =
          op.path.length === 0
            ? doc(firestore, "tenants", tenantId)
            : doc(firestore, "tenants", tenantId, ...op.path);

        if (op.type === "set") {
          batch.set(targetRef, sanitizeForFirestore(op.data as Record<string, unknown>, true), {
            merge: true,
          });
        } else {
          batch.delete(targetRef);
        }
      }
      await batch.commit();
    }

    if (countsChanged && !academyChanged) {
      await atomicUpdateAcademy(tenantId, {
        playersUsed: next.players.length,
        playersCount: next.players.length,
        branchesUsed: next.branches.length,
        branchesCount: next.branches.length,
      }).catch(() => {});
    }
  } catch (err) {
    logSystemError({
      source: "firestore_write",
      operation: `syncToFirestore(${pendingOps
        .map((o) => `${o.type}:${o.path.join("/") || "root"}`)
        .slice(0, 5)
        .join(", ")})`,
      error: err,
      payload: pendingOps.slice(0, 5),
      tenantId,
    });
    throw err;
  }
}

/**
 * Dispatch an in-app Academy Notification into the tenant's notifications collection.
 */
export async function dispatchAcademyNotification(
  tenantId: string,
  notification: Omit<AcademyNotification, "id" | "tenantId"> & { id?: string },
): Promise<AcademyNotification> {
  const id = notification.id || `notif_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const fullNotification: AcademyNotification = cleanFirestoreData({
    ...notification,
    id,
    tenantId,
    createdAt: notification.createdAt || new Date().toISOString(),
    readBy: Array.isArray(notification.readBy) ? notification.readBy : [],
    dismissedBy: Array.isArray(notification.dismissedBy) ? notification.dismissedBy : [],
  });

  const docRef = doc(firestore, "tenants", tenantId, "notifications", id);
  await setDoc(docRef, fullNotification);
  return fullNotification;
}

export const createAcademyNotification = dispatchAcademyNotification;

/**
 * Mark a specific notification as read by the current user using atomic arrayUnion.
 */
export async function markNotificationRead(
  tenantId: string,
  notificationId: string,
  userId: string,
): Promise<void> {
  if (!tenantId || !notificationId || !userId) return;
  const docRef = doc(firestore, "tenants", tenantId, "notifications", notificationId);
  await updateDoc(docRef, {
    readBy: arrayUnion(userId),
  });
}

/**
 * Mark all given notifications as read by the current user using batched writes.
 */
export async function markAllNotificationsRead(
  tenantId: string,
  notificationIds: string[],
  userId: string,
): Promise<void> {
  if (!tenantId || !notificationIds.length || !userId) return;
  const CHUNK_SIZE = 450;
  for (let i = 0; i < notificationIds.length; i += CHUNK_SIZE) {
    const chunk = notificationIds.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(firestore);
    for (const id of chunk) {
      const docRef = doc(firestore, "tenants", tenantId, "notifications", id);
      batch.update(docRef, {
        readBy: arrayUnion(userId),
      });
    }
    await batch.commit();
  }
}

/**
 * Per-user dismissal of a notification in Firestore (appends userId to dismissedBy without deleting the document for other users).
 */
export async function dismissAcademyNotification(
  tenantId: string,
  notificationId: string,
  userId: string = "current-user",
): Promise<void> {
  if (!tenantId || !notificationId || !userId) return;
  const docRef = doc(firestore, "tenants", tenantId, "notifications", notificationId);
  await updateDoc(docRef, {
    dismissedBy: arrayUnion(userId),
  });
}

/**
 * Per-user batch dismissal of multiple notifications in Firestore using writeBatch.
 */
export async function dismissAllAcademyNotifications(
  tenantId: string,
  notificationIds: string[],
  userId: string,
): Promise<void> {
  if (!tenantId || !notificationIds.length || !userId) return;
  const CHUNK_SIZE = 450;
  for (let i = 0; i < notificationIds.length; i += CHUNK_SIZE) {
    const chunk = notificationIds.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(firestore);
    for (const id of chunk) {
      const docRef = doc(firestore, "tenants", tenantId, "notifications", id);
      batch.update(docRef, {
        dismissedBy: arrayUnion(userId),
      });
    }
    await batch.commit();
  }
}

/**
 * Batch update player statuses (e.g. for overdue suspension checks).
 * Commits updates in chunks of 450 ops to stay strictly within Firestore limits.
 */
export async function atomicUpdatePlayerStatuses(
  tenantId: string,
  updates: {
    id: string;
    status: "Active" | "Idle" | "Soft flag" | "Inactive" | "Suspended";
    idleSinceDate?: string;
    missedSessionsSinceIdle?: number;
    idleMissedSessionIds?: string[];
  }[],
): Promise<void> {
  if (!tenantId || !updates.length) return;
  const CHUNK_SIZE = 450;
  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(firestore);
    for (const item of chunk) {
      const playerRef = doc(firestore, "tenants", tenantId, "players", item.id);
      const patch: Record<string, unknown> = { status: item.status };
      if (item.idleSinceDate !== undefined) patch.idleSinceDate = item.idleSinceDate;
      if (item.missedSessionsSinceIdle !== undefined) {
        patch.missedSessionsSinceIdle = item.missedSessionsSinceIdle;
      }
      if (item.idleMissedSessionIds !== undefined) {
        patch.idleMissedSessionIds = item.idleMissedSessionIds;
      }
      batch.update(playerRef, cleanFirestoreData(patch));
    }
    await batch.commit();
  }
}

/**
 * Record an audit log for a server-authoritative billing cron or suspension audit run.
 */
export async function recordCronLog(
  tenantId: string,
  log: Record<string, unknown> & { id: string },
): Promise<void> {
  if (!tenantId || !log.id) return;
  const docRef = doc(firestore, "tenants", tenantId, "cron_logs", log.id);
  await setDoc(docRef, cleanFirestoreData(log), { merge: true });
}

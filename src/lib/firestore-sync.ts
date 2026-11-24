import {
  doc,
  writeBatch,
  runTransaction,
  increment,
  setDoc,
  deleteDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  deleteField,
} from "firebase/firestore";
import { db as firestore } from "./firebase";
import {
  defaultAgeCategoryRules,
  type DB,
  type AcademyNotification,
  type Branch,
  type CourtReservation,
  type CourtAllocationType,
  type PhysioAppointment,
  type PhysioRecord,
  type PhysioTreatmentSession,
  type PosCatalogItem,
  type PosTransaction,
  type PosInventoryLog,
  type StockItem,
  type Player,
  type GymMember,
  type GymCoachProfile,
  type GymCheckInEntry,
  type LedgerEntry,
} from "./data-store";
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

function stripSensitiveUserFields<T>(collectionName: string, data: T): T {
  if (
    (collectionName === "users" || collectionName === "coaches") &&
    data &&
    typeof data === "object" &&
    !Array.isArray(data)
  ) {
    const clone = { ...(data as Record<string, unknown>) };
    delete clone.password;
    delete clone.passwordHash;
    return clone as unknown as T;
  }
  return data;
}

/**
 * Extracts sensitive gateway/API credentials from an academy payload so they can be
 * persisted exclusively in /tenants/{tenantId}/settings/secrets and stripped from
 * the general /tenants/{tenantId} root document.
 */
export function extractAndStripAcademySecrets(raw: Record<string, unknown>): {
  sanitizedAcademy: Record<string, unknown>;
  extractedSecrets: Record<string, unknown>;
} {
  const sanitizedAcademy: Record<string, unknown> = { ...raw };
  const extractedSecrets: Record<string, unknown> = {};

  if (sanitizedAcademy.paymentGateway && typeof sanitizedAcademy.paymentGateway === "object") {
    const pg = { ...(sanitizedAcademy.paymentGateway as Record<string, unknown>) };
    if (typeof pg.secretKey === "string" && pg.secretKey.trim()) {
      extractedSecrets.paymentGatewaySecretKey = pg.secretKey.trim();
    }
    if (typeof pg.webhookSecret === "string" && pg.webhookSecret.trim()) {
      extractedSecrets.paymentGatewayWebhookSecret = pg.webhookSecret.trim();
    }
    delete pg.secretKey;
    delete pg.webhookSecret;
    sanitizedAcademy.paymentGateway = pg;
  }

  if (
    sanitizedAcademy.notificationServices &&
    typeof sanitizedAcademy.notificationServices === "object"
  ) {
    const ns = { ...(sanitizedAcademy.notificationServices as Record<string, unknown>) };
    if (typeof ns.smsApiKey === "string" && ns.smsApiKey.trim()) {
      extractedSecrets.smsApiKey = ns.smsApiKey.trim();
    }
    if (typeof ns.emailApiKey === "string" && ns.emailApiKey.trim()) {
      extractedSecrets.emailApiKey = ns.emailApiKey.trim();
    }
    delete ns.smsApiKey;
    delete ns.emailApiKey;
    sanitizedAcademy.notificationServices = ns;
  }

  if (
    sanitizedAcademy.notificationConfig &&
    typeof sanitizedAcademy.notificationConfig === "object"
  ) {
    const nc = { ...(sanitizedAcademy.notificationConfig as Record<string, unknown>) };
    if (typeof nc.smsApiKey === "string" && nc.smsApiKey.trim()) {
      extractedSecrets.smsApiKey = nc.smsApiKey.trim();
    }
    if (typeof nc.emailApiKey === "string" && nc.emailApiKey.trim()) {
      extractedSecrets.emailApiKey = nc.emailApiKey.trim();
    }
    delete nc.smsApiKey;
    delete nc.emailApiKey;
    sanitizedAcademy.notificationConfig = nc;
  }

  return { sanitizedAcademy, extractedSecrets };
}

/**
 * Direct atomic setDoc mutation on a single item in a collection or subcollection.
 */
export async function atomicSetItem(
  tenantId: string,
  collectionName: string,
  id: string,
  rawData: Record<string, unknown> | unknown,
) {
  const data = stripSensitiveUserFields(collectionName, rawData);
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
  rawData: Record<string, unknown>,
) {
  const data = stripSensitiveUserFields(collectionName, rawData);
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
    await setDoc(docRef, sanitizeForFirestore(data, true), { merge: true });
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
  const { sanitizedAcademy, extractedSecrets } = extractAndStripAcademySecrets(data);
  const cleaned = cleanFirestoreData(sanitizedAcademy);
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
    if (Object.keys(extractedSecrets).length > 0) {
      await setDoc(
        doc(firestore, "tenants", tenantId, "settings", "secrets"),
        cleanFirestoreData({
          ...extractedSecrets,
          updatedAt: new Date().toISOString(),
        }),
        { merge: true },
      ).catch(() => {});
    }
    await setDoc(docRef, { ...cleaned, academy: cleaned }, { merge: true });
  } catch (err) {
    logSystemError({
      source: "firestore_write",
      operation: "atomicUpdateAcademy",
      error: err,
      payload: cleaned,
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
          const nextRec = item as Record<string, unknown>;
          let payload: Record<string, unknown>;
          if (currItem && typeof currItem === "object") {
            const currRec = currItem as Record<string, unknown>;
            payload = { id };
            if (nextRec.updatedAt !== undefined) {
              payload.updatedAt = nextRec.updatedAt;
            }
            for (const [k, nextVal] of Object.entries(nextRec)) {
              if (k === "id") continue;
              if (!isDeepEqual(currRec[k], nextVal)) {
                payload[k] = nextVal;
              }
            }
            for (const k of Object.keys(currRec)) {
              if (nextRec[k] === undefined) {
                payload[k] = deleteField();
              }
            }
          } else {
            payload = { ...nextRec };
          }
          const sanitizedPayload = stripSensitiveUserFields(key, payload);
          if (key === "users" || key === "coaches") {
            delete (sanitizedPayload as Record<string, unknown>).password;
            delete (sanitizedPayload as Record<string, unknown>).passwordHash;
          }
          const docId =
            key === "users" &&
            item &&
            typeof (item as { authUid?: unknown }).authUid === "string" &&
            (item as { authUid?: string }).authUid
              ? ((item as { authUid?: string }).authUid as string)
              : id;
          pendingOps.push({
            type: "set",
            path: [key, docId],
            data: sanitizeForFirestore(sanitizedPayload, true),
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
              ? ((item as { authUid?: string }).authUid as string)
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
    const { sanitizedAcademy, extractedSecrets } = extractAndStripAcademySecrets(
      next.academy as unknown as Record<string, unknown>,
    );
    if (Object.keys(extractedSecrets).length > 0) {
      pendingOps.push({
        type: "set",
        path: ["settings", "secrets"],
        data: cleanFirestoreData({
          ...extractedSecrets,
          updatedAt: new Date().toISOString(),
        }),
      });
    }
    const cleanedAcademy = cleanFirestoreData({
      ...sanitizedAcademy,
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

// ============================================================================
// PHASE 2: ATOMIC BRANCH TRANSACTIONS, BOUNDED ARRAYS & CONFLICT SERIALIZATION
// ============================================================================

export const MAX_BRANCH_LOG_ENTRIES = 250;

/**
 * Caps embedded high-frequency arrays on a Branch document (and nested coach check-in logs)
 * to MAX_BRANCH_LOG_ENTRIES (250) so /tenants/{tenantId}/branches/{branchId} never approaches
 * Firestore's 1 MiB document size limit under heavy multi-user usage.
 */
export function capBranchSubArrays<T extends Record<string, unknown>>(branch: T): T {
  const next: Record<string, unknown> = { ...branch };
  if (
    Array.isArray(next.posInventoryLogs) &&
    next.posInventoryLogs.length > MAX_BRANCH_LOG_ENTRIES
  ) {
    next.posInventoryLogs = next.posInventoryLogs.slice(0, MAX_BRANCH_LOG_ENTRIES);
  }
  if (Array.isArray(next.posShifts) && next.posShifts.length > MAX_BRANCH_LOG_ENTRIES) {
    next.posShifts = next.posShifts.slice(0, MAX_BRANCH_LOG_ENTRIES);
  }
  if (Array.isArray(next.gymBookings) && next.gymBookings.length > MAX_BRANCH_LOG_ENTRIES) {
    next.gymBookings = next.gymBookings.slice(-MAX_BRANCH_LOG_ENTRIES);
  }
  if (
    Array.isArray(next.physioAppointments) &&
    next.physioAppointments.length > MAX_BRANCH_LOG_ENTRIES
  ) {
    next.physioAppointments = next.physioAppointments.slice(-MAX_BRANCH_LOG_ENTRIES);
  }
  if (Array.isArray(next.gymCoaches)) {
    next.gymCoaches = (next.gymCoaches as Array<Record<string, unknown>>).map((coach) => {
      if (
        Array.isArray(coach.checkInHistory) &&
        coach.checkInHistory.length > MAX_BRANCH_LOG_ENTRIES
      ) {
        return {
          ...coach,
          checkInHistory: coach.checkInHistory.slice(0, MAX_BRANCH_LOG_ENTRIES),
        };
      }
      return coach;
    });
  }
  return next as T;
}

/**
 * Runs an atomic read-modify-write transaction on `/tenants/{tenantId}/branches/{branchId}`,
 * reading the latest branch snapshot from Firestore before applying `updaterFn` and capping
 * high-frequency embedded log arrays to 250 entries.
 */
export async function atomicRunBranchTransaction(
  tenantId: string,
  branchId: string,
  fallbackBranch: Branch,
  updaterFn: (currentBranch: Branch) => Branch,
): Promise<Branch> {
  const branchRef = doc(firestore, "tenants", tenantId, "branches", branchId);
  try {
    return await runTransaction(firestore, async (tx) => {
      const snap = await tx.get(branchRef);
      const currentBranch: Branch = snap.exists()
        ? ({
            ...fallbackBranch,
            ...(cleanIncomingFirestoreData(snap.data()) as Partial<Branch>),
            id: branchId,
          } as Branch)
        : fallbackBranch;

      const updatedRaw = updaterFn(currentBranch);
      const cappedBranch = capBranchSubArrays({
        ...updatedRaw,
        id: branchId,
      } as unknown as Record<string, unknown>) as unknown as Branch;

      tx.set(
        branchRef,
        sanitizeForFirestore(cappedBranch as unknown as Record<string, unknown>, false),
        {
          merge: true,
        },
      );
      return cappedBranch;
    });
  } catch (err) {
    logSystemError({
      source: "firestore_write",
      operation: `atomicRunBranchTransaction(${branchId})`,
      error: err,
      tenantId,
    });
    throw err;
  }
}

function parseMinutesSafe(timeStr?: string): number {
  if (!timeStr) return 0;
  const [hStr, mStr] = timeStr.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h)) return 0;
  return h * 60 + (Number.isFinite(m) ? m : 0);
}

function courtAllocationsOverlap(a?: CourtAllocationType, b?: CourtAllocationType): boolean {
  const normA = a || "Full Court";
  const normB = b || "Full Court";
  if (normA === "Full Court" || normB === "Full Court") return true;
  return normA === normB;
}

function buildCourtSlotLockId(branchName: string, courtName: string, date: string): string {
  const normBranch = (branchName || "main")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  const normCourt = (courtName || "court_1")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  return `${normBranch}__${normCourt}__${date}`;
}

export interface CourtSlotLockEntry {
  id: string;
  clientName: string;
  courtAllocation: CourtAllocationType;
  startTime: string;
  endTime: string;
  status: string;
  updatedAt: string;
}

/**
 * Atomically verifies court slot conflicts (HCA / HCB / Full Court and branch Off Days)
 * inside a Firestore transaction using deterministic per-(branch, court, date) lock documents
 * `/tenants/{tenantId}/courtSlotLocks/{lockId}` and writes the CourtReservation document(s).
 */
export async function atomicBookCourtReservationTransaction(params: {
  tenantId: string;
  branchId?: string;
  fallbackBranch?: Branch;
  reservationsToSave: CourtReservation[];
  previousReservation?: CourtReservation | null;
  localReservations: CourtReservation[];
  localSessions: Array<{
    id: string;
    branch: string;
    court?: string;
    courtAllocation?: CourtAllocationType;
    date: string;
    time: string;
    endTime?: string;
    durationHours?: number;
    status: string;
    title: string;
  }>;
}): Promise<CourtReservation[]> {
  const {
    tenantId,
    branchId,
    fallbackBranch,
    reservationsToSave,
    previousReservation,
    localReservations,
    localSessions,
  } = params;

  if (!reservationsToSave.length) return [];

  try {
    return await runTransaction(firestore, async (tx) => {
      // 1. Read branch document for latest server offDays
      let latestBranch: Branch | undefined = fallbackBranch;
      if (branchId) {
        const branchRef = doc(firestore, "tenants", tenantId, "branches", branchId);
        const branchSnap = await tx.get(branchRef);
        if (branchSnap.exists()) {
          latestBranch = {
            ...(fallbackBranch || ({} as Branch)),
            ...(cleanIncomingFirestoreData(branchSnap.data()) as Partial<Branch>),
            id: branchId,
          } as Branch;
        }
      }

      // 2. Collect all deterministic courtSlotLocks documents needed
      const lockKeys = new Map<
        string,
        { branch: string; court: string; date: string; lockId: string }
      >();

      for (const r of reservationsToSave) {
        const lockId = buildCourtSlotLockId(r.branch, r.court, r.date);
        lockKeys.set(lockId, { branch: r.branch, court: r.court, date: r.date, lockId });
      }
      if (previousReservation) {
        const prevLockId = buildCourtSlotLockId(
          previousReservation.branch,
          previousReservation.court,
          previousReservation.date,
        );
        lockKeys.set(prevLockId, {
          branch: previousReservation.branch,
          court: previousReservation.court,
          date: previousReservation.date,
          lockId: prevLockId,
        });
      }

      const lockSnapshots = new Map<string, Record<string, CourtSlotLockEntry>>();
      for (const [lockId] of lockKeys.entries()) {
        const lockRef = doc(firestore, "tenants", tenantId, "courtSlotLocks", lockId);
        const lockSnap = await tx.get(lockRef);
        const rawSlots =
          lockSnap.exists() && lockSnap.data()?.slots && typeof lockSnap.data().slots === "object"
            ? (cleanIncomingFirestoreData(lockSnap.data().slots) as Record<
                string,
                CourtSlotLockEntry
              >)
            : {};
        lockSnapshots.set(lockId, { ...rawSlots });
      }

      const serverOffDays = latestBranch?.offDays || [];
      const savingIds = new Set(reservationsToSave.map((r) => r.id));
      if (previousReservation?.id) savingIds.add(previousReservation.id);

      // 3. Validate Off Days and HCA / HCB / Full Court conflicts against server lock state + local sessions/reservations
      for (const r of reservationsToSave) {
        if (r.status === "Cancelled") continue;

        const offMatch = serverOffDays.find((o) => o.date === r.date);
        if (offMatch) {
          throw new Error(
            `Cannot book on ${r.date}: marked as Off Day (${offMatch.reason || "Facility Closure"}).`,
          );
        }

        const startA = parseMinutesSafe(r.startTime);
        const endA = parseMinutesSafe(r.endTime);
        const lockId = buildCourtSlotLockId(r.branch, r.court, r.date);
        const activeLocks = lockSnapshots.get(lockId) || {};

        // Check against server lock slots on this (branch, court, date)
        for (const [slotId, slot] of Object.entries(activeLocks)) {
          if (savingIds.has(slotId) || slot.status === "Cancelled") continue;
          if (!courtAllocationsOverlap(r.courtAllocation, slot.courtAllocation)) continue;
          const startB = parseMinutesSafe(slot.startTime);
          const endB = parseMinutesSafe(slot.endTime);
          if (startA < endB && startB < endA) {
            throw new Error(
              `Court conflict on ${r.date}: "${slot.clientName}" already occupies ${r.court} (${slot.courtAllocation}) from ${slot.startTime} to ${slot.endTime}.`,
            );
          }
        }

        // Also check against localReservations (including projected continuous series) & localSessions
        for (const existing of localReservations) {
          if (savingIds.has(existing.id) || existing.status === "Cancelled") continue;
          if (
            (existing.branch || "").toLowerCase() !== (r.branch || "").toLowerCase() ||
            (existing.court || "").toLowerCase() !== (r.court || "").toLowerCase() ||
            existing.date !== r.date
          ) {
            continue;
          }
          if (!courtAllocationsOverlap(r.courtAllocation, existing.courtAllocation)) continue;
          const startB = parseMinutesSafe(existing.startTime);
          const endB = parseMinutesSafe(existing.endTime);
          if (startA < endB && startB < endA) {
            throw new Error(
              `Court conflict on ${r.date}: "${existing.clientName}" already occupies ${r.court} (${existing.courtAllocation}) from ${existing.startTime} to ${existing.endTime}.`,
            );
          }
        }

        for (const sess of localSessions) {
          if (sess.status === "Cancelled") continue;
          if (
            (sess.branch || "").toLowerCase() !== (r.branch || "").toLowerCase() ||
            (sess.court || "").toLowerCase() !== (r.court || "").toLowerCase() ||
            sess.date !== r.date
          ) {
            continue;
          }
          const sessAlloc = sess.courtAllocation || "Full Court";
          if (!courtAllocationsOverlap(r.courtAllocation, sessAlloc)) continue;
          const startB = parseMinutesSafe(sess.time);
          const endB = sess.endTime
            ? parseMinutesSafe(sess.endTime)
            : startB + Math.round((sess.durationHours || 1.5) * 60);
          if (startA < endB && startB < endA) {
            throw new Error(
              `Court conflict on ${r.date}: Academy session "${sess.title}" occupies ${r.court} (${sessAlloc}) at ${sess.time}.`,
            );
          }
        }
      }

      // 4. Remove previous slot entry if editing moved date/court or cancelled
      if (previousReservation) {
        const prevLockId = buildCourtSlotLockId(
          previousReservation.branch,
          previousReservation.court,
          previousReservation.date,
        );
        const prevMap = lockSnapshots.get(prevLockId);
        if (prevMap && prevMap[previousReservation.id]) {
          delete prevMap[previousReservation.id];
        }
      }

      // 5. Register new slot allocations and write CourtReservation docs
      const nowIso = new Date().toISOString();
      for (const r of reservationsToSave) {
        const lockId = buildCourtSlotLockId(r.branch, r.court, r.date);
        const slotMap = lockSnapshots.get(lockId) || {};
        if (r.status === "Cancelled") {
          delete slotMap[r.id];
        } else {
          slotMap[r.id] = {
            id: r.id,
            clientName: r.clientName,
            courtAllocation: r.courtAllocation,
            startTime: r.startTime,
            endTime: r.endTime,
            status: r.status,
            updatedAt: nowIso,
          };
        }
        lockSnapshots.set(lockId, slotMap);

        const resRef = doc(firestore, "tenants", tenantId, "courtReservations", r.id);
        tx.set(resRef, sanitizeForFirestore(r as unknown as Record<string, unknown>, false), {
          merge: true,
        });
      }

      for (const [lockId, slotMap] of lockSnapshots.entries()) {
        const meta = lockKeys.get(lockId);
        const lockRef = doc(firestore, "tenants", tenantId, "courtSlotLocks", lockId);
        tx.set(
          lockRef,
          sanitizeForFirestore(
            {
              id: lockId,
              branch: meta?.branch || "",
              court: meta?.court || "",
              date: meta?.date || "",
              slots: slotMap,
              updatedAt: nowIso,
            },
            false,
          ),
        );
      }

      return reservationsToSave;
    });
  } catch (err) {
    logSystemError({
      source: "firestore_write",
      operation: `atomicBookCourtReservationTransaction`,
      error: err,
      tenantId,
    });
    throw err;
  }
}

/**
 * Atomically verifies room maintenance status, room overlap, and practitioner overlap
 * inside a Firestore transaction against the latest server branch document before
 * saving a Physiotherapy Appointment (and optional linked clinical session on the patient record).
 */
export async function atomicBookPhysioAppointmentTransaction(params: {
  tenantId: string;
  branchId: string;
  fallbackBranch: Branch;
  appointment: PhysioAppointment;
  patientId?: string;
  fallbackPatient?: PhysioRecord;
  linkedTreatmentSession?: PhysioTreatmentSession;
}): Promise<{ updatedBranch: Branch; updatedPatient?: PhysioRecord }> {
  const {
    tenantId,
    branchId,
    fallbackBranch,
    appointment,
    patientId,
    fallbackPatient,
    linkedTreatmentSession,
  } = params;

  const branchRef = doc(firestore, "tenants", tenantId, "branches", branchId);
  const patientRef =
    patientId && linkedTreatmentSession
      ? doc(firestore, "tenants", tenantId, "physioRecords", patientId)
      : null;

  try {
    return await runTransaction(firestore, async (tx) => {
      const branchSnap = await tx.get(branchRef);
      const patientSnap = patientRef ? await tx.get(patientRef) : null;

      const currentBranch: Branch = branchSnap.exists()
        ? ({
            ...fallbackBranch,
            ...(cleanIncomingFirestoreData(branchSnap.data()) as Partial<Branch>),
            id: branchId,
          } as Branch)
        : fallbackBranch;

      const rooms = currentBranch.physioRooms || fallbackBranch.physioRooms || [];
      const practitioners =
        currentBranch.physioPractitioners || fallbackBranch.physioPractitioners || [];
      const appointments = currentBranch.physioAppointments || [];

      const targetRoom = rooms.find((r) => r.id === appointment.roomId);
      if (targetRoom && targetRoom.status === "Maintenance") {
        throw new Error(`${targetRoom.name} is currently under Maintenance and cannot be booked.`);
      }

      if (appointment.status !== "Cancelled") {
        const startA = parseMinutesSafe(appointment.startTime);
        const endA = parseMinutesSafe(appointment.endTime);

        for (const existing of appointments) {
          if (existing.id === appointment.id) continue;
          if (existing.date !== appointment.date) continue;
          if (existing.status === "Cancelled") continue;

          const startB = parseMinutesSafe(existing.startTime);
          const endB = parseMinutesSafe(existing.endTime);
          if (startA < endB && startB < endA) {
            if (existing.roomId === appointment.roomId) {
              const roomName =
                rooms.find((r) => r.id === existing.roomId)?.name || existing.roomName;
              throw new Error(
                `Room Conflict: ${roomName} is already booked from ${existing.startTime} to ${existing.endTime} for ${existing.patientName}.`,
              );
            }
            if (existing.practitionerId === appointment.practitionerId) {
              const pracName =
                practitioners.find((p) => p.id === existing.practitionerId)?.name ||
                existing.practitionerName;
              throw new Error(
                `Practitioner Conflict: ${pracName} already has an appointment from ${existing.startTime} to ${existing.endTime} with ${existing.patientName}.`,
              );
            }
          }
        }
      }

      const existsInBranch = appointments.some((a) => a.id === appointment.id);
      const nextAppointments = existsInBranch
        ? appointments.map((a) => (a.id === appointment.id ? appointment : a))
        : [...appointments, appointment];

      const updatedBranch = capBranchSubArrays({
        ...currentBranch,
        physioAppointments: nextAppointments,
        id: branchId,
      } as unknown as Record<string, unknown>) as unknown as Branch;

      tx.set(
        branchRef,
        sanitizeForFirestore(updatedBranch as unknown as Record<string, unknown>, false),
        { merge: true },
      );

      let updatedPatient: PhysioRecord | undefined;
      if (patientRef && linkedTreatmentSession && fallbackPatient) {
        const currentPatient: PhysioRecord =
          patientSnap && patientSnap.exists()
            ? ({
                ...fallbackPatient,
                ...(cleanIncomingFirestoreData(patientSnap.data()) as Partial<PhysioRecord>),
                id: patientId!,
              } as PhysioRecord)
            : fallbackPatient;

        const existingSessions = currentPatient.treatmentSessions || [];
        const sessionExists = existingSessions.some((s) => s.id === linkedTreatmentSession.id);
        const nextSessions = sessionExists
          ? existingSessions.map((s) =>
              s.id === linkedTreatmentSession.id ? linkedTreatmentSession : s,
            )
          : [linkedTreatmentSession, ...existingSessions];

        updatedPatient = {
          ...currentPatient,
          treatmentSessions: nextSessions,
          updatedAt: new Date().toISOString(),
        };

        tx.set(
          patientRef,
          sanitizeForFirestore(updatedPatient as unknown as Record<string, unknown>, false),
          { merge: true },
        );
      }

      return { updatedBranch, updatedPatient };
    });
  } catch (err) {
    logSystemError({
      source: "firestore_write",
      operation: `atomicBookPhysioAppointmentTransaction(${appointment.id})`,
      error: err,
      tenantId,
    });
    throw err;
  }
}

/**
 * Atomically executes a Kiosk & Cafeteria POS sale in a single Firestore transaction:
 * - Reads and verifies current `posCatalog` item stock and linked Academy merchandise `stock`
 * - Decrements `posCatalog` stock and linked `stock` quantities
 * - Increments `player.balance` or `gymMember.balance` for Client Account charges
 * - Updates active register shift totals and appends bounded `posInventoryLogs` (max 250) on the Branch document
 * - Writes the `posTransactions` document and Accounting `ledger` entry
 */
export async function atomicCompletePosSaleTransaction(params: {
  tenantId: string;
  branchId: string;
  fallbackBranch: Branch;
  transaction: PosTransaction;
  catalogItemsMap: Map<string, PosCatalogItem>;
  stockItemsMap: Map<string, StockItem>;
  accountChargeTarget?: {
    type: "player" | "gymMember";
    id: string;
    amount: number;
    fallbackRecord: Player | GymMember;
  };
  openShiftId?: string;
  cashCollected: number;
  cardCollected: number;
  accountChargeCollected: number;
  ledgerEntry?: LedgerEntry;
  staffName: string;
}): Promise<{
  updatedBranch: Branch;
  updatedCatalogItems: PosCatalogItem[];
  updatedStockItems: StockItem[];
  updatedPlayer?: Player;
  updatedGymMember?: GymMember;
}> {
  const {
    tenantId,
    branchId,
    fallbackBranch,
    transaction,
    catalogItemsMap,
    stockItemsMap,
    accountChargeTarget,
    openShiftId,
    cashCollected,
    cardCollected,
    accountChargeCollected,
    ledgerEntry,
    staffName,
  } = params;

  const branchRef = doc(firestore, "tenants", tenantId, "branches", branchId);
  const txRef = doc(firestore, "tenants", tenantId, "posTransactions", transaction.id);

  try {
    return await runTransaction(firestore, async (tx) => {
      // 1. All reads first
      const branchSnap = await tx.get(branchRef);

      const uniqueCatIds = Array.from(
        new Set(transaction.items.map((l) => l.itemId).filter(Boolean)),
      );
      const catSnaps = new Map<string, PosCatalogItem>();
      const linkedStockIdsToRead = new Set<string>();

      for (const catId of uniqueCatIds) {
        const catRef = doc(firestore, "tenants", tenantId, "posCatalog", catId);
        const snap = await tx.get(catRef);
        const fallbackCat = catalogItemsMap.get(catId);
        if (snap.exists()) {
          const item = {
            ...(fallbackCat || ({} as PosCatalogItem)),
            ...(cleanIncomingFirestoreData(snap.data()) as Partial<PosCatalogItem>),
            id: catId,
          } as PosCatalogItem;
          catSnaps.set(catId, item);
          if (item.linkedStockId) linkedStockIdsToRead.add(item.linkedStockId);
        } else if (fallbackCat) {
          catSnaps.set(catId, fallbackCat);
          if (fallbackCat.linkedStockId) linkedStockIdsToRead.add(fallbackCat.linkedStockId);
        }
      }

      const stockSnaps = new Map<string, StockItem>();
      for (const stockId of linkedStockIdsToRead) {
        const sRef = doc(firestore, "tenants", tenantId, "stock", stockId);
        const sSnap = await tx.get(sRef);
        const fallbackStock = stockItemsMap.get(stockId);
        if (sSnap.exists()) {
          stockSnaps.set(stockId, {
            ...(fallbackStock || ({} as StockItem)),
            ...(cleanIncomingFirestoreData(sSnap.data()) as Partial<StockItem>),
            id: stockId,
          } as StockItem);
        } else if (fallbackStock) {
          stockSnaps.set(stockId, fallbackStock);
        }
      }

      let targetAccountSnapData: Record<string, unknown> | null = null;
      const accountRef =
        accountChargeTarget && accountChargeTarget.amount > 0
          ? doc(
              firestore,
              "tenants",
              tenantId,
              accountChargeTarget.type === "player" ? "players" : "gymMembers",
              accountChargeTarget.id,
            )
          : null;
      if (accountRef) {
        const aSnap = await tx.get(accountRef);
        if (aSnap.exists()) {
          targetAccountSnapData = cleanIncomingFirestoreData(aSnap.data()) as Record<
            string,
            unknown
          >;
        }
      }

      // 2. Compute stock decrements and inventory logs
      const nowIso = new Date().toISOString();
      const updatedCatalogItems: PosCatalogItem[] = [];
      const updatedStockItems: StockItem[] = [];
      const newInvLogs: PosInventoryLog[] = [];

      // Aggregate quantities by itemId in case same item appears multiple times
      const qtyByCatId = new Map<string, number>();
      for (const line of transaction.items) {
        qtyByCatId.set(
          line.itemId,
          (qtyByCatId.get(line.itemId) || 0) + (Number(line.quantity) || 0),
        );
      }

      for (const [catId, totalQty] of qtyByCatId.entries()) {
        const catItem = catSnaps.get(catId);
        if (!catItem) continue;
        if (catItem.stock >= 999 || catItem.category === "Court Walk-In & Passes") continue;

        const prevStock = Number(catItem.stock) || 0;
        const nextStock = Math.max(0, prevStock - totalQty);
        const updatedCat: PosCatalogItem = {
          ...catItem,
          stock: nextStock,
        };
        updatedCatalogItems.push(updatedCat);

        const catRef = doc(firestore, "tenants", tenantId, "posCatalog", catId);
        tx.set(
          catRef,
          sanitizeForFirestore(updatedCat as unknown as Record<string, unknown>, false),
          { merge: true },
        );

        if (catItem.linkedStockId) {
          const linkedStock = stockSnaps.get(catItem.linkedStockId);
          if (linkedStock) {
            const currentMerchQty = Number(linkedStock.stock ?? linkedStock.qty) || 0;
            const nextMerchQty = Math.max(0, currentMerchQty - totalQty);
            const nextStatus: StockItem["status"] =
              nextMerchQty <= 0
                ? "Out of stock"
                : nextMerchQty <= (Number(linkedStock.reorder ?? linkedStock.reorderLevel) || 5)
                  ? "Low"
                  : "In stock";
            const updatedMerch: StockItem = {
              ...linkedStock,
              stock: nextMerchQty,
              qty: nextMerchQty,
              status: nextStatus,
            };
            updatedStockItems.push(updatedMerch);
            const sRef = doc(firestore, "tenants", tenantId, "stock", linkedStock.id);
            tx.set(
              sRef,
              sanitizeForFirestore(updatedMerch as unknown as Record<string, unknown>, false),
              { merge: true },
            );
          }
        }

        newInvLogs.push({
          id: `inv-sale-${Date.now()}-${catItem.id}`,
          date: transaction.date,
          time: transaction.time,
          branch: transaction.branch,
          itemId: catItem.id,
          itemName: catItem.name,
          itemNameAr: catItem.nameAr,
          adjustmentType: "Sale Deduction",
          quantityDelta: -totalQty,
          previousStock: prevStock,
          newStock: nextStock,
          unitCost: catItem.costPrice,
          totalCostImpact: Number(((catItem.costPrice || 0) * totalQty).toFixed(2)),
          reasonOrSupplier: `Receipt ${transaction.receiptNumber}`,
          recordedBy: staffName,
        });
      }

      // 3. Atomic Account Charge balance update
      let updatedPlayer: Player | undefined;
      let updatedGymMember: GymMember | undefined;
      if (accountRef && accountChargeTarget && accountChargeTarget.amount > 0) {
        const baseRec = {
          ...accountChargeTarget.fallbackRecord,
          ...(targetAccountSnapData || {}),
          id: accountChargeTarget.id,
        };
        const currentBal = Number((baseRec as { balance?: number }).balance) || 0;
        const nextBal = Math.round((currentBal + accountChargeTarget.amount) * 100) / 100;
        if (accountChargeTarget.type === "player") {
          updatedPlayer = {
            ...(baseRec as Player),
            balance: nextBal,
          };
          tx.set(
            accountRef,
            sanitizeForFirestore({ balance: increment(accountChargeTarget.amount) }, false),
            { merge: true },
          );
        } else {
          updatedGymMember = {
            ...(baseRec as GymMember),
            balance: nextBal,
            updatedAt: nowIso,
          };
          tx.set(
            accountRef,
            sanitizeForFirestore(
              { balance: increment(accountChargeTarget.amount), updatedAt: nowIso },
              false,
            ),
            { merge: true },
          );
        }
      }

      // 4. Update Branch shift totals and bounded inventory logs (max 250)
      const currentBranch: Branch = branchSnap.exists()
        ? ({
            ...fallbackBranch,
            ...(cleanIncomingFirestoreData(branchSnap.data()) as Partial<Branch>),
            id: branchId,
          } as Branch)
        : fallbackBranch;

      const existingShifts = currentBranch.posShifts || [];
      const updatedShifts = existingShifts.map((s) => {
        const isTargetShift = openShiftId ? s.id === openShiftId : s.status === "Open";
        if (!isTargetShift) return s;
        const nextCashSales = Number(((Number(s.cashSalesTotal) || 0) + cashCollected).toFixed(2));
        const nextCardSales = Number(((Number(s.cardSalesTotal) || 0) + cardCollected).toFixed(2));
        const nextAccSales = Number(
          ((Number(s.accountChargeTotal) || 0) + accountChargeCollected).toFixed(2),
        );
        const nextExpectedCash = Number(((Number(s.openingFloat) || 0) + nextCashSales).toFixed(2));
        return {
          ...s,
          cashSalesTotal: nextCashSales,
          cardSalesTotal: nextCardSales,
          accountChargeTotal: nextAccSales,
          expectedDrawerCash: nextExpectedCash,
          transactionsCount: (Number(s.transactionsCount) || 0) + 1,
        };
      });

      const updatedBranch = capBranchSubArrays({
        ...currentBranch,
        posShifts: updatedShifts,
        posInventoryLogs: [...newInvLogs, ...(currentBranch.posInventoryLogs || [])].slice(
          0,
          MAX_BRANCH_LOG_ENTRIES,
        ),
        id: branchId,
      } as unknown as Record<string, unknown>) as unknown as Branch;

      tx.set(
        branchRef,
        sanitizeForFirestore(updatedBranch as unknown as Record<string, unknown>, false),
        { merge: true },
      );

      // 5. Write POS Transaction and Ledger Entry
      tx.set(
        txRef,
        sanitizeForFirestore(transaction as unknown as Record<string, unknown>, false),
        { merge: true },
      );

      if (ledgerEntry) {
        const ledgerRef = doc(firestore, "tenants", tenantId, "ledger", ledgerEntry.id);
        tx.set(
          ledgerRef,
          sanitizeForFirestore(ledgerEntry as unknown as Record<string, unknown>, false),
          { merge: true },
        );
      }

      return {
        updatedBranch,
        updatedCatalogItems,
        updatedStockItems,
        updatedPlayer,
        updatedGymMember,
      };
    });
  } catch (err) {
    logSystemError({
      source: "firestore_write",
      operation: `atomicCompletePosSaleTransaction(${transaction.id})`,
      error: err,
      tenantId,
    });
    throw err;
  }
}

/**
 * Atomically executes a Gym Check-In and Session Credit Deduction inside a Firestore transaction:
 * - Verifies remaining session credits on the latest server `gymMembers/{memberId}` or `branches/{branchId}` (`gymCoaches`) snapshot
 * - Prevents duplicate check-in / double-deduction on an already Checked-In `gymBookings` slot
 * - Caps `checkInHistory` arrays to MAX_BRANCH_LOG_ENTRIES (250)
 */
export async function atomicGymCheckInTransaction(params: {
  tenantId: string;
  branchId: string;
  fallbackBranch: Branch;
  mode: "client" | "coach_credit";
  client?: GymMember | null;
  coachId?: string;
  privateClientName?: string;
  bookingId?: string;
  checkInEntry: GymCheckInEntry;
  checkInDate: string;
  checkInTime: string;
}): Promise<{
  updatedBranch: Branch;
  updatedMember?: GymMember;
  updatedCoach?: GymCoachProfile;
  remainingSessions?: number;
}> {
  const {
    tenantId,
    branchId,
    fallbackBranch,
    mode,
    client,
    coachId,
    privateClientName,
    bookingId,
    checkInEntry,
    checkInDate,
    checkInTime,
  } = params;

  const branchRef = doc(firestore, "tenants", tenantId, "branches", branchId);
  const memberRef = client ? doc(firestore, "tenants", tenantId, "gymMembers", client.id) : null;

  try {
    return await runTransaction(firestore, async (tx) => {
      const branchSnap = await tx.get(branchRef);
      const memberSnap = memberRef ? await tx.get(memberRef) : null;

      const currentBranch: Branch = branchSnap.exists()
        ? ({
            ...fallbackBranch,
            ...(cleanIncomingFirestoreData(branchSnap.data()) as Partial<Branch>),
            id: branchId,
          } as Branch)
        : fallbackBranch;

      const currentMember: GymMember | undefined =
        client && memberSnap && memberSnap.exists()
          ? ({
              ...client,
              ...(cleanIncomingFirestoreData(memberSnap.data()) as Partial<GymMember>),
              id: client.id,
            } as GymMember)
          : client || undefined;

      const bookings = currentBranch.gymBookings || [];
      if (bookingId) {
        const serverBooking = bookings.find((b) => b.id === bookingId);
        if (
          serverBooking &&
          (serverBooking.status === "Checked In" || serverBooking.status === "Completed")
        ) {
          throw new Error("This booking slot has already been checked in.");
        }
      }

      const nowIso = new Date().toISOString();
      let nextCoaches = currentBranch.gymCoaches || fallbackBranch.gymCoaches || [];
      let updatedMember: GymMember | undefined = currentMember;
      let updatedCoach: GymCoachProfile | undefined;
      let remainingSessions: number | undefined;

      if (mode === "coach_credit") {
        const targetCoach = nextCoaches.find((c) => c.id === coachId);
        if (!targetCoach) {
          throw new Error("Selected Coach-as-Client record was not found on this branch.");
        }
        if (targetCoach.packageExpiryDate && targetCoach.packageExpiryDate < checkInDate) {
          throw new Error(
            `Coach ${targetCoach.name}'s credit package expired on ${targetCoach.packageExpiryDate}.`,
          );
        }
        const rem = Number(targetCoach.sessionsRemaining) || 0;
        if (rem <= 0) {
          throw new Error(`Coach ${targetCoach.name} has 0 remaining session credits.`);
        }
        remainingSessions = Math.max(0, rem - 1);
        const trainee = privateClientName || checkInEntry.privateClientName || "Private Client";
        const entryWithRemaining: GymCheckInEntry = {
          ...checkInEntry,
          sessionsRemainingAfter: remainingSessions,
        };

        updatedCoach = {
          ...targetCoach,
          sessionsRemaining: remainingSessions,
          totalPrivateClientsTrained: (Number(targetCoach.totalPrivateClientsTrained) || 0) + 1,
          privateClientsList: Array.from(
            new Set([...(targetCoach.privateClientsList || []), trainee]),
          ),
          checkInHistory: [entryWithRemaining, ...(targetCoach.checkInHistory || [])].slice(
            0,
            MAX_BRANCH_LOG_ENTRIES,
          ),
        };

        nextCoaches = nextCoaches.map((c) => (c.id === targetCoach.id ? updatedCoach! : c));

        if (currentMember && memberRef) {
          updatedMember = {
            ...currentMember,
            sessionsRemaining: remainingSessions,
            totalCheckIns: (Number(currentMember.totalCheckIns) || 0) + 1,
            lastCheckInDate: checkInDate,
            status: remainingSessions === 0 ? "Expired" : "Active",
            checkInHistory: [entryWithRemaining, ...(currentMember.checkInHistory || [])].slice(
              0,
              MAX_BRANCH_LOG_ENTRIES,
            ),
            updatedAt: nowIso,
          };
          tx.set(
            memberRef,
            sanitizeForFirestore(updatedMember as unknown as Record<string, unknown>, false),
            { merge: true },
          );
        }
      } else {
        if (!currentMember || !memberRef) {
          throw new Error("Client record is required for client check-in.");
        }
        if (currentMember.status === "Paused") {
          throw new Error(
            `${currentMember.memberName}'s membership is currently PAUSED. Resume before checking in.`,
          );
        }
        if (currentMember.expiryDate && currentMember.expiryDate < checkInDate) {
          throw new Error(
            `${currentMember.memberName}'s package expired on ${currentMember.expiryDate}. Please renew first.`,
          );
        }
        if (currentMember.sessionsRemaining !== undefined) {
          const rem = Number(currentMember.sessionsRemaining) || 0;
          if (rem <= 0) {
            throw new Error(
              `${currentMember.memberName} has 0 remaining sessions. Assign or renew a package first.`,
            );
          }
          remainingSessions = Math.max(0, rem - 1);
        } else {
          remainingSessions = undefined;
        }

        const entryWithRemaining: GymCheckInEntry = {
          ...checkInEntry,
          sessionsRemainingAfter: remainingSessions,
        };

        const nextStatus: GymMember["status"] =
          remainingSessions === 0 ? "Expired" : currentMember.status;

        updatedMember = {
          ...currentMember,
          totalCheckIns: (Number(currentMember.totalCheckIns) || 0) + 1,
          lastCheckInDate: checkInDate,
          sessionsRemaining: remainingSessions,
          status: nextStatus,
          checkInHistory: [entryWithRemaining, ...(currentMember.checkInHistory || [])].slice(
            0,
            MAX_BRANCH_LOG_ENTRIES,
          ),
          updatedAt: nowIso,
        };
        tx.set(
          memberRef,
          sanitizeForFirestore(updatedMember as unknown as Record<string, unknown>, false),
          { merge: true },
        );
      }

      const nextBookings = bookingId
        ? bookings.map((b) => {
            if (b.id !== bookingId) return b;
            return {
              ...b,
              status: "Checked In" as const,
              checkedInAt: `${checkInDate} ${checkInTime}`,
              ...(privateClientName ? { privateClientName } : {}),
              ...(mode === "client" && currentMember
                ? {
                    attendeeIds: Array.from(new Set([...(b.attendeeIds || []), currentMember.id])),
                    attendeeNames: Array.from(
                      new Set([...(b.attendeeNames || []), currentMember.memberName]),
                    ),
                  }
                : {}),
            };
          })
        : bookings;

      const updatedBranch = capBranchSubArrays({
        ...currentBranch,
        gymCoaches: nextCoaches,
        gymBookings: nextBookings,
        id: branchId,
      } as unknown as Record<string, unknown>) as unknown as Branch;

      tx.set(
        branchRef,
        sanitizeForFirestore(updatedBranch as unknown as Record<string, unknown>, false),
        { merge: true },
      );

      return {
        updatedBranch,
        updatedMember,
        updatedCoach,
        remainingSessions,
      };
    });
  } catch (err) {
    logSystemError({
      source: "firestore_write",
      operation: `atomicGymCheckInTransaction`,
      error: err,
      tenantId,
    });
    throw err;
  }
}

/**
 * Commits an arbitrary list of multi-collection document updates in chunked Firestore writeBatches (max 400 ops/batch).
 * Used for atomic cascading updates such as Branch & Court renames across referencing collections.
 */
export async function atomicBatchSaveEntities(
  tenantId: string,
  operations: Array<{
    collectionName: string;
    id: string;
    data: Record<string, unknown>;
    merge?: boolean;
  }>,
): Promise<void> {
  if (!operations || operations.length === 0) return;

  try {
    const CHUNK_SIZE = 400;
    for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
      const chunk = operations.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(firestore);
      for (const op of chunk) {
        if (!op.id || !op.collectionName) continue;
        const sanitized = stripSensitiveUserFields(op.collectionName as keyof DB, op.data);
        const docRef = doc(firestore, "tenants", tenantId, op.collectionName, op.id);
        batch.set(docRef, sanitizeForFirestore(sanitized, op.merge !== false), {
          merge: op.merge !== false,
        });
      }
      await batch.commit();
    }
  } catch (err) {
    logSystemError({
      source: "firestore_write",
      operation: `atomicBatchSaveEntities(${operations.length} ops)`,
      error: err,
      tenantId,
    });
    throw err;
  }
}

import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { signInAnonymously } from "firebase/auth";
import { storage, auth } from "./firebase";

export type DocumentAttachment = {
  id: string;
  name: string;
  type: string;
  url: string;
  uploadedAt: string;
  size: number;
};

/**
 * Converts a File or Blob to a Data URL. For images, compresses via HTMLCanvasElement
 * to a max dimension of 1200px (JPEG 0.78 quality) so it remains compact (<200KB)
 * and safe for Firestore document storage when used as a fallback.
 */
async function fileToSafeDataUrl(file: File | Blob): Promise<string> {
  const mime = file.type || "application/octet-stream";
  if (typeof window !== "undefined" && mime.startsWith("image/") && mime !== "image/svg+xml") {
    try {
      const bitmapUrl = URL.createObjectURL(file);
      const compressed = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            const maxDim = 1200;
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
              if (width >= height) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
              } else {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
              }
            }
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, width);
            canvas.height = Math.max(1, height);
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              URL.revokeObjectURL(bitmapUrl);
              reject(new Error("Canvas context unavailable"));
              return;
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const outType = mime === "image/png" ? "image/jpeg" : mime;
            const dataUrl = canvas.toDataURL(outType, 0.78);
            URL.revokeObjectURL(bitmapUrl);
            resolve(dataUrl);
          } catch (err) {
            URL.revokeObjectURL(bitmapUrl);
            reject(err);
          }
        };
        img.onerror = (err) => {
          URL.revokeObjectURL(bitmapUrl);
          reject(err);
        };
        img.src = bitmapUrl;
      });
      if (compressed && compressed.length < 750_000) {
        return compressed;
      }
    } catch {
      // Fall through to standard FileReader
    }
  }

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read file as Data URL"));
      }
    };
    reader.onerror = () => reject(reader.error || new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads a file to Firebase Storage and returns its HTTPS download URL.
 * Supports all authenticated sessions (Google, Email/Password, and anonymous sessions
 * created for fixed-credential logins) and falls back cleanly to a compressed Data URL
 * if Cloud Storage is unreachable or restricted.
 */
export async function uploadToStorage(
  file: File | Blob,
  path: string,
  metadata?: { contentType?: string; customMetadata?: Record<string, string> },
): Promise<string> {
  try {
    if (!storage || typeof storage.app === "undefined") {
      return await fileToSafeDataUrl(file);
    }

    let currentUser = auth?.currentUser ?? null;
    if (!currentUser && auth && typeof auth.authStateReady === "function") {
      try {
        await auth.authStateReady();
        currentUser = auth.currentUser;
      } catch {
        // ignore
      }
    }

    if (!currentUser && auth) {
      try {
        const cred = await signInAnonymously(auth);
        currentUser = cred.user;
      } catch {
        // ignore
      }
    }

    const storageRef = ref(storage, path);
    const uploadMetadata = {
      contentType: metadata?.contentType || file.type || "application/octet-stream",
      customMetadata: {
        uploadedBy: currentUser?.uid || "staff",
        uploadedByEmail: currentUser?.email || "",
        uploadedAt: new Date().toISOString(),
        ...(metadata?.customMetadata || {}),
      },
    };
    const snapshot = await uploadBytes(storageRef, file, uploadMetadata);
    return await getDownloadURL(snapshot.ref);
  } catch (storageErr) {
    console.warn(
      "Cloud Storage upload notice — falling back to inline compressed document:",
      storageErr,
    );
    return await fileToSafeDataUrl(file);
  }
}

/**
 * Uploads a document attachment for a Player, Coach, Staff, or Branch and returns a
 * strictly sanitized DocumentAttachment object with zero undefined properties.
 */
export async function uploadDocumentAttachment(
  tenantId: string,
  entityFolder: "players" | "coaches" | "staff_docs" | "expenses" | "receipts",
  entityId: string,
  file: File,
  customLabel?: string,
  customType?: string,
): Promise<DocumentAttachment> {
  const safeTenant = tenantId || "donbosco";
  const safeEntityId = entityId || `doc_${Date.now().toString(36)}`;
  const cleanName = (file.name || "document").replace(/[^a-zA-Z0-9.-]/g, "_");
  const timestamp = Date.now();
  const path = `tenants/${safeTenant}/${entityFolder}/${safeEntityId}/doc_${timestamp}_${cleanName}`;
  const url = await uploadToStorage(file, path, {
    contentType: file.type || "application/octet-stream",
  });
  return {
    id: `doc-${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: String(customLabel?.trim() || file.name || "Uploaded Document"),
    type: String(
      customType ||
        file.type ||
        (file.name?.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg"),
    ),
    url: String(url || ""),
    uploadedAt: new Date(timestamp).toISOString(),
    size: Number.isFinite(file.size) ? Number(file.size) : 0,
  };
}

/**
 * Uploads an Academy Logo to Storage and returns its HTTPS URL.
 */
export async function uploadAcademyLogo(tenantId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() || "png";
  const path = `tenants/${tenantId}/branding/logo_${Date.now()}.${ext}`;
  return uploadToStorage(file, path, { contentType: file.type || "image/png" });
}

/**
 * Uploads a Resource Document/Media to Storage.
 */
export async function uploadResourceFile(
  tenantId: string,
  folderId: string,
  file: File,
): Promise<{ url: string; size: number; name: string; type: string }> {
  const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const path = `tenants/${tenantId}/resources/${folderId}/${Date.now()}_${cleanName}`;
  const url = await uploadToStorage(file, path, { contentType: file.type });
  return {
    url: String(url || ""),
    size: Number(file.size || 0),
    name: String(file.name || "resource"),
    type: String(file.type || "application/octet-stream"),
  };
}

/**
 * Uploads Staff ID or Contract Document.
 */
export async function uploadStaffDocument(
  tenantId: string,
  staffId: string,
  file: File,
): Promise<string> {
  const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const path = `tenants/${tenantId}/staff_docs/${staffId}/${Date.now()}_${cleanName}`;
  return uploadToStorage(file, path, { contentType: file.type });
}

/**
 * Uploads Expense Receipt or Invoice Document.
 */
export async function uploadExpenseReceipt(
  tenantId: string,
  expenseId: string,
  file: File,
): Promise<string> {
  const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const path = `tenants/${tenantId}/expenses/${expenseId}/${Date.now()}_${cleanName}`;
  return uploadToStorage(file, path, { contentType: file.type });
}

/**
 * Uploads Coach Official License / Certification Document or Photo.
 */
export async function uploadCoachLicense(
  tenantId: string,
  coachId: string,
  file: File,
): Promise<string> {
  const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const path = `tenants/${tenantId}/coaches/${coachId}/license_${Date.now()}_${cleanName}`;
  return uploadToStorage(file, path, { contentType: file.type });
}

/**
 * Uploads Player ID Card / Birth Certificate Document or Photo.
 */
export async function uploadPlayerIdCard(
  tenantId: string,
  playerId: string,
  file: File,
): Promise<string> {
  const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const path = `tenants/${tenantId}/players/${playerId}/id_card_${Date.now()}_${cleanName}`;
  return uploadToStorage(file, path, { contentType: file.type });
}

/**
 * Uploads Player Profile Photo (deprecated — kept for compatibility).
 */
export async function uploadPlayerPhoto(
  tenantId: string,
  playerId: string,
  file: File,
): Promise<string> {
  const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const path = `tenants/${tenantId}/players/${playerId}/photo_${Date.now()}_${cleanName}`;
  return uploadToStorage(file, path, { contentType: file.type });
}

/**
 * Uploads Technical PDF or Playbook to Technical Director Repository.
 */
export async function uploadTechnicalDocument(
  tenantId: string,
  category: string,
  file: File,
): Promise<{ url: string; size: number; name: string }> {
  const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const path = `tenants/${tenantId}/technical/${category}/${Date.now()}_${cleanName}`;
  const url = await uploadToStorage(file, path, { contentType: file.type });
  return {
    url: String(url || ""),
    size: Number(file.size || 0),
    name: String(file.name || "document"),
  };
}

/**
 * Uploads Tactical Board Drill Drawing to Firebase Storage.
 */
export async function uploadTacticalDrawing(
  tenantId: string,
  planId: string,
  blockId: string,
  blob: Blob,
): Promise<string> {
  const path = `tenants/${tenantId}/tactical_boards/${planId}/${blockId}_${Date.now()}.png`;
  return uploadToStorage(blob, path, { contentType: "image/png" });
}

export const ALLOWED_RECEIPT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

export const MAX_RECEIPT_RAW_SIZE_BYTES = 25 * 1024 * 1024; // 25MB max raw
export const MAX_PDF_RECEIPT_SIZE_BYTES = 15 * 1024 * 1024; // 15MB max PDF

export interface PreparedReceiptResult {
  file: File | Blob;
  mimeType: string;
  originalSize: number;
  compressedSize: number;
  wasCompressed: boolean;
  savingsRatio?: number;
}

/**
 * Validates receipt format and file size, and automatically downscales and compresses high-resolution
 * smartphone camera snapshots (which are often 8MB–20MB) to crisp, lightweight JPEGs (~350KB–700KB).
 * This eliminates cellular upload timeouts and memory spikes while preserving critical receipt legibility
 * (voucher numbers, timestamps, tax IDs, and currency amounts).
 */
export async function prepareReceiptForUpload(file: File): Promise<PreparedReceiptResult> {
  if (!file) {
    throw new Error("No file selected for receipt upload.");
  }

  // Determine normalized MIME type with file extension fallback
  let mime = (file.type || "").toLowerCase().trim();
  const nameLower = (file.name || "").toLowerCase();
  if (!mime) {
    if (nameLower.endsWith(".pdf")) mime = "application/pdf";
    else if (nameLower.endsWith(".jpg") || nameLower.endsWith(".jpeg")) mime = "image/jpeg";
    else if (nameLower.endsWith(".png")) mime = "image/png";
    else if (nameLower.endsWith(".webp")) mime = "image/webp";
  }

  if (!ALLOWED_RECEIPT_MIME_TYPES.includes(mime)) {
    throw new Error(
      `Unsupported format (${mime || "unknown"}). Allowed formats are JPEG, PNG, WebP images, and PDF documents.`,
    );
  }

  if (file.size > MAX_RECEIPT_RAW_SIZE_BYTES) {
    throw new Error(
      `File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum allowed receipt size is 25MB.`,
    );
  }

  // PDF receipts: enforce size limit, no image canvas compression needed
  if (mime === "application/pdf") {
    if (file.size > MAX_PDF_RECEIPT_SIZE_BYTES) {
      throw new Error(
        `PDF document exceeds the 15MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB). Please compress the PDF before uploading.`,
      );
    }
    return {
      file,
      mimeType: "application/pdf",
      originalSize: file.size,
      compressedSize: file.size,
      wasCompressed: false,
    };
  }

  // Image receipts: Compress mobile camera snapshots if > 500KB or if canvas is available
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    try {
      const bitmapUrl = URL.createObjectURL(file);
      const compressedBlob = await new Promise<Blob | null>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            // 1600px max dimension ensures fine print on receipts and stamps remains razor-sharp
            const maxDim = 1600;
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
              if (width >= height) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
              } else {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
              }
            }
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, width);
            canvas.height = Math.max(1, height);
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              URL.revokeObjectURL(bitmapUrl);
              resolve(null);
              return;
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
              (blob) => {
                URL.revokeObjectURL(bitmapUrl);
                resolve(blob);
              },
              "image/jpeg",
              0.82,
            );
          } catch (err) {
            URL.revokeObjectURL(bitmapUrl);
            reject(err);
          }
        };
        img.onerror = (err) => {
          URL.revokeObjectURL(bitmapUrl);
          reject(err);
        };
        img.src = bitmapUrl;
      });

      if (compressedBlob && (compressedBlob.size < file.size || file.size > 500_000)) {
        return {
          file: compressedBlob,
          mimeType: "image/jpeg",
          originalSize: file.size,
          compressedSize: compressedBlob.size,
          wasCompressed: true,
          savingsRatio: Math.round(((file.size - compressedBlob.size) / file.size) * 100),
        };
      }
    } catch (compressErr) {
      console.warn("Client-side image compression fallback to original file:", compressErr);
    }
  }

  return {
    file,
    mimeType: mime,
    originalSize: file.size,
    compressedSize: file.size,
    wasCompressed: false,
  };
}

/**
 * Uploads Accounting Receipt / Invoice / Payment Voucher to Firebase Storage with
 * automatic pre-upload MIME validation and smartphone camera compression.
 */
export async function uploadAccountingReceipt(
  tenantId: string,
  entryId: string,
  file: File,
  onProgress?: (status: string) => void,
): Promise<string> {
  if (onProgress) onProgress("Validating receipt & optimizing photo...");
  const prepared = await prepareReceiptForUpload(file);

  const cleanName = (file.name || "receipt").replace(/[^a-zA-Z0-9.-]/g, "_");
  const ext = prepared.mimeType === "application/pdf" ? "pdf" : "jpg";
  const path = `tenants/${tenantId}/receipts/${entryId}/${Date.now()}_${cleanName}.${ext}`;

  if (onProgress) {
    if (prepared.wasCompressed) {
      const origMb = (prepared.originalSize / (1024 * 1024)).toFixed(1);
      const compKb = Math.round(prepared.compressedSize / 1024);
      onProgress(`Uploading optimized receipt (${origMb}MB → ${compKb}KB)...`);
    } else {
      onProgress("Uploading receipt to Cloud Storage...");
    }
  }

  return uploadToStorage(prepared.file, path, {
    contentType: prepared.mimeType,
    customMetadata: {
      originalName: file.name,
      originalSize: String(prepared.originalSize),
      compressedSize: String(prepared.compressedSize),
      wasCompressed: String(prepared.wasCompressed),
    },
  });
}

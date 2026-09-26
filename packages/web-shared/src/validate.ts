/**
 * Client-side input validation.
 *
 * This is a defence-in-depth layer, not the security boundary: uploads go
 * straight to Supabase Storage with the anon key, so the *real* control is the
 * storage bucket's RLS/storage policy plus the served content type. What this
 * module guarantees is that a merchant cannot easily store an oversized file, a
 * non-image, or a filename that escapes their prefix, and that the operator
 * gets a clear message instead of a raw `400 Bad Request`.
 */

/** 5 MB. Comfortably above a phone photo, low enough to protect the bucket. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/webp"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** ASCII control characters, which are never legitimate in a filename. */
function isControlCode(code: number): boolean {
  return code < 0x20 || code === 0x7f;
}

/** Magic-byte signatures for the public upload formats we accept. */
const SIGNATURES: Array<{ type: AllowedImageType; test: (b: Uint8Array) => boolean }> = [
  { type: "image/jpeg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/webp",
    test: (b) =>
      b.length > 12 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
];

export type ImageValidation = { ok: true; type: AllowedImageType } | { ok: false; error: string };

/**
 * Reads the first bytes of a blob. Uses `Blob.arrayBuffer()` where available and
 * falls back to `FileReader` for older Safari, so signature checks never throw
 * in the browser.
 */
async function readHeaderBytes(blob: Blob, length: number): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("Gagal membaca file."));
    reader.readAsArrayBuffer(blob.slice(0, length));
  });
}

/** Cheap, synchronous checks on size and declared MIME type. */
export function validateImageFile(file: File | null | undefined): ImageValidation {
  if (!file) return { ok: false, error: "Pilih gambar terlebih dahulu." };
  if (file.size === 0) return { ok: false, error: "File gambar kosong." };
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: `Ukuran gambar maksimal ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.` };
  }
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, error: "Format gambar harus JPG atau WebP." };
  }
  return { ok: true, type: file.type as AllowedImageType };
}

/**
 * Confirms the bytes actually match the declared type. A `.svg` renamed to
 * `.png` and an HTML polyglot both fail here, which matters because these
 * buckets are publicly readable.
 */
export async function verifyImageSignature(file: File): Promise<ImageValidation> {
  let header: Uint8Array;
  try {
    header = await readHeaderBytes(file, 16);
  } catch {
    return { ok: false, error: "Gagal membaca file gambar. Coba pilih ulang." };
  }
  const match = SIGNATURES.find((signature) => signature.test(header));
  if (!match) return { ok: false, error: "Isi file bukan gambar JPG atau WebP yang valid." };
  if (match.type !== file.type) return { ok: false, error: "Format file tidak cocok dengan isinya." };
  return { ok: true, type: match.type };
}

/**
 * Reduces an arbitrary user filename to a safe, non-empty object name.
 * Returns `undefined` when nothing usable survives, so callers can fall back
 * to a generated name instead of uploading something like `..`.
 */
export function safeStorageName(name: string | null | undefined): string | undefined {
  if (!name) return undefined;

  const withoutControlChars = Array.from(name)
    .filter((char) => !isControlCode(char.charCodeAt(0)))
    .join("");

  const cleaned = withoutControlChars
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 80);

  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Builds an object path scoped to the uploader: `<ownerId>/<prefix>-<ts>-<name>`.
 * The owner id is server-issued, the name is sanitised, and no segment can be
 * empty, `.` or `..`, so traversal is impossible.
 */
export function storageObjectPath(ownerId: string, file: File, prefix = "upload"): string {
  const safeOwner = safeStorageName(ownerId) ?? "anonymous";
  const safeName = safeStorageName(file.name) ?? `file.${file.type.split("/")[1] ?? "bin"}`;
  return `${safeOwner}/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
}

/** Map bounds; anything outside is a data-entry mistake. */
export function parseCoordinate(
  raw: string | number | null | undefined,
  kind: "lat" | "lng",
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
  if (!Number.isFinite(value)) return null;
  const limit = kind === "lat" ? 90 : 180;
  if (value < -limit || value > limit) return null;
  return value;
}

/** Non-empty trimmed string with an upper bound, or `undefined`. */
export function requiredText(
  value: string | null | undefined,
  maxLength: number,
): string | undefined {
  const text = (value ?? "").trim();
  if (!text) return undefined;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

/** Positive money amount in whole rupiah. */
export function parseRupiahAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  }
  // Accept "Rp 25.500" / "25,500" but reject signs, exponents and anything else.
  // Stripping every non-digit would turn "-5" into 5, i.e. a negative price
  // silently becoming a positive one.
  const normalized = raw.trim().replace(/^rp\s*/i, "").replace(/[\s.]/g, "");
  if (!/^\d{1,15}$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

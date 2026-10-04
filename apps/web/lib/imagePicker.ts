"use client";

/**
 * The web equivalent of `ImagePicker().pickImage(source: gallery, maxWidth:
 * 1280, imageQuality: 80)`: opens the file chooser, then re-encodes the photo
 * as a JPEG no wider than 1280 px at 80% quality. Re-encoding also strips EXIF
 * (including GPS) before the photo reaches a public bucket.
 */

export type PickedImage = { bytes: Uint8Array; filename: string };

/**
 * Must be called synchronously from a user gesture (a click handler):
 * browsers only open the file chooser with transient user activation.
 */
export function pickImageFile(accept = "image/*"): Promise<File | null> {
  return new Promise<File | null>((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.position = "fixed";
    input.style.left = "-10000px";
    input.style.opacity = "0";
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(file);
    };
    // Browsers without the `cancel` event: when focus returns and no file was
    // chosen, treat it as a cancel.
    const onFocus = () => {
      setTimeout(() => {
        if (!input.files?.length) finish(null);
      }, 800);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    window.addEventListener("focus", onFocus);
    document.body.appendChild(input);
    input.click();
  });
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through to <img> decoding (older Safari, unusual formats).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Resizes to `maxWidth` and encodes as JPEG at `quality` (0–1). */
export async function compressImage(file: File, maxWidth = 1280, quality = 0.8): Promise<PickedImage> {
  const decoded = await decode(file);
  try {
    const scale = decoded.width > maxWidth ? maxWidth / decoded.width : 1;
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas tidak tersedia.");
    // JPEG has no alpha: paint white under transparent PNG/WebP pixels.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(decoded.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("Gambar tidak dapat diproses.");
    const base = (file.name || "image").replace(/\.[^.]+$/, "") || "image";
    return { bytes: new Uint8Array(await blob.arrayBuffer()), filename: `${base}.jpg` };
  } finally {
    decoded.close();
  }
}

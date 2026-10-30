/**
 * Kompresi gambar sisi-klien (v1.23.0) — dipakai form Testimoni sebelum
 * mengunggah: skala ke sisi maksimum, encode WebP (fallback JPEG pada
 * peramban lama), dan pastikan data URI di bawah batas karakter penyimpanan.
 *
 * Berjalan sepenuhnya di perangkat admin/dev → request API tetap kecil
 * (~ratusan KB per foto), server tidak pernah re-encode.
 */

export type CompressOptions = {
  /** Sisi terpanjang maksimum (px). */
  maxSide?: number;
  /** Kualitas WebP awal 0–1. */
  quality?: number;
  /** Batas panjang data URI (karakter) hasil akhir. */
  maxChars?: number;
};

const DEFAULTS = {
  maxSide: 1400,
  quality: 0.8,
  maxChars: 300_000,
};

export class ImageTooLargeError extends Error {
  constructor() {
    super("Foto terlalu besar untuk disimpan. Coba foto dengan resolusi lebih kecil.");
    this.name = "ImageTooLargeError";
  }
}

export class UnsupportedImageError extends Error {
  constructor() {
    super("File bukan gambar yang didukung (PNG/JPEG/WebP).");
    this.name = "UnsupportedImageError";
  }
}

/** Skala fit sisi terpanjang ke maxSide, menjaga rasio. */
function fitSize(w: number, h: number, maxSide: number): { w: number; h: number } {
  if (Math.max(w, h) <= maxSide) return { w, h };
  const ratio = maxSide / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * ratio)), h: Math.max(1, Math.round(h * ratio)) };
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): string {
  return canvas.toDataURL(type, quality);
}

/**
 * Kompres satu file gambar → data URI.
 * Strategi: WebP q0.8 pada maxSide → bila melebihi maxChars, WebP q0.72 pada
 * maxSide×0.85 → bila masih, JPEG q0.75 → bila masih, lempar ImageTooLargeError.
 * Peramban tanpa encoder WebP otomatis jatuh ke JPEG pada langkah pertama.
 */
export async function compressImageToDataUri(
  file: File,
  opts: CompressOptions = {}
): Promise<string> {
  const { maxSide, quality, maxChars } = { ...DEFAULTS, ...opts };

  if (!file.type || !file.type.startsWith("image/") || file.type === "image/svg+xml") {
    throw new UnsupportedImageError();
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UnsupportedImageError();
  }

  try {
    const attempts: Array<{ side: number; type: string; q: number }> = [
      { side: maxSide, type: "image/webp", q: quality },
      { side: Math.round(maxSide * 0.85), type: "image/webp", q: 0.72 },
      { side: Math.round(maxSide * 0.85), type: "image/jpeg", q: 0.75 },
    ];
    for (const attempt of attempts) {
      const { w, h } = fitSize(bitmap.width, bitmap.height, attempt.side);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new UnsupportedImageError();
      ctx.drawImage(bitmap, 0, 0, w, h);
      const uri = encode(canvas, attempt.type, attempt.q);
      // canvas.toDataURL jatuh ke PNG bila type tak didukung — cek prefiks.
      const encodedType = uri.slice(5, uri.indexOf(";"));
      if (attempt.type === "image/webp" && encodedType !== "image/webp") continue;
      if (uri.length <= maxChars) return uri;
    }
    throw new ImageTooLargeError();
  } finally {
    bitmap.close();
  }
}

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Wishlist store (v1.21.0) — produk favorit tersimpan per perangkat.
 *
 * Toko ini tidak memiliki akun pelanggan (sesi hanya untuk admin/developer
 * via env), jadi pola yang benar mengikuti keranjang: zustand + persist
 * localStorage. State yang dipersisten diperlakukan UNTRUSTED — `merge`
 * mensanitasi bentuk, panjang, dan batas jumlah supaya storage korup
 * tidak pernah merusak halaman.
 *
 * Harga TIDAK disimpan — selalu di-resolve live dari katalog saat
 * wishlist dibuka (produk bisa berharga/hapus dari katalog kapan pun).
 */

export const MAX_WISHLIST_ITEMS = 30;

const STORAGE_KEY = "nexa-store-wishlist-v1";

export type WishlistEntry = {
  productId: string;
  gameId: string;
  /** Slug game — dipakai tombol "lihat game"; boleh null (di-resolve via gameId). */
  gameSlug: string | null;
  gameName: string;
  gameImage: string | null;
  denomination: string;
  productName: string;
  addedAt: string;
};

export type ToggleWishlistResult = "added" | "removed" | "full";

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const ls = window.localStorage;
    ls.setItem("__nexa_probe__", "1");
    ls.removeItem("__nexa_probe__");
    return ls;
  } catch {
    return null;
  }
}

function asString(v: unknown, max = 120): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function asImage(v: unknown): string | null {
  const s = asString(v, 300);
  if (!s) return null;
  // Hanya path asal-usul sama atau URL absolut — tolak javascript: dsb.
  return s.startsWith("/") || /^https?:\/\//i.test(s) ? s : null;
}

/** Shape check ketat untuk entri yang dipersisten (input tidak dipercaya). */
function sanitizeEntry(raw: unknown): WishlistEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const productId = asString(r.productId);
  const gameId = asString(r.gameId);
  const gameName = asString(r.gameName, 80);
  const denomination = asString(r.denomination, 80);
  const productName = asString(r.productName, 120);
  if (!productId || !gameId || !gameName || !denomination || !productName) return null;
  return {
    productId,
    gameId,
    gameSlug: asString(r.gameSlug, 120) || null,
    gameName,
    gameImage: asImage(r.gameImage),
    denomination,
    productName,
    addedAt: asString(r.addedAt, 40) || new Date().toISOString(),
  };
}

type WishlistState = {
  entries: WishlistEntry[];
  /** Drawer terbuka? Tidak dipersisten — murni UI. */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Toggle produk; entri terbaru selalu di depan. */
  toggle: (entry: WishlistEntry) => ToggleWishlistResult;
  remove: (productId: string) => void;
  clear: () => void;
};

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      entries: [],
      open: false,

      setOpen: (open) => set({ open }),

      toggle(entry) {
        const entries = get().entries;
        if (entries.some((e) => e.productId === entry.productId)) {
          set({ entries: entries.filter((e) => e.productId !== entry.productId) });
          return "removed";
        }
        if (entries.length >= MAX_WISHLIST_ITEMS) return "full";
        set({ entries: [entry, ...entries].slice(0, MAX_WISHLIST_ITEMS) });
        return "added";
      },

      remove(productId) {
        set({ entries: get().entries.filter((e) => e.productId !== productId) });
      },

      clear() {
        set({ entries: [] });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => (safeLocalStorage() ?? undefined) as Storage),
      version: 1,
      partialize: (s) => ({ entries: s.entries }),
      merge: (persisted, current) => {
        const p = persisted as Partial<Pick<WishlistState, "entries">> | undefined;
        const entries = Array.isArray(p?.entries)
          ? p.entries
              .map(sanitizeEntry)
              .filter((x): x is WishlistEntry => x !== null)
              .slice(0, MAX_WISHLIST_ITEMS)
          : [];
        return { ...current, entries };
      },
    }
  )
);

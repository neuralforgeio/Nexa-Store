import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  MAX_CART_ITEMS,
  MAX_ORDER_HISTORY,
  emptyRecipient,
  type AddItemResult,
  type CartItem,
  type CartRecipient,
  type LocalOrderRecord,
} from "./types";

/**
 * Cart + local order history store.
 *
 * Persistence: localStorage (safe client-side layer). Persisted state is
 * treated as UNTRUSTED — `merge` sanitizes shape, caps and drops malformed
 * entries so corrupted storage can never crash checkout.
 *
 * Prices are never stored here; they are resolved live from the catalog.
 */

const STORAGE_KEY = "nexa-store-cart-v1";

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

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `it-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Strict shape check for a persisted cart item (untrusted input). */
function sanitizeItem(raw: unknown): CartItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = asString(r.id).trim();
  const productId = asString(r.productId).trim();
  const gameId = asString(r.gameId).trim();
  if (!id || !productId || !gameId) return null;

  const rec = (r.recipient ?? {}) as Record<string, unknown>;
  const fieldsRaw = (rec.fields ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(fieldsRaw)) {
    if (typeof v === "string" && v.length <= 200) fields[k] = v;
  }

  return {
    id,
    productId,
    gameId,
    addedAt: asString(r.addedAt) || new Date().toISOString(),
    recipient: {
      customerName: asString(rec.customerName).slice(0, 80),
      note: asString(rec.note).slice(0, 300),
      fields,
    },
  };
}

function sanitizeOrder(raw: unknown): LocalOrderRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const reference = asString(r.reference).trim();
  const createdAt = asString(r.createdAt).trim();
  if (!reference || !createdAt) return null;
  const items = Array.isArray(r.items)
    ? r.items
        .map((it): LocalOrderRecord["items"][number] | null => {
          if (!it || typeof it !== "object") return null;
          const o = it as Record<string, unknown>;
          const productName = asString(o.productName).trim();
          if (!productName) return null;
          return {
            gameName: asString(o.gameName).trim() || "-",
            productName,
            price: typeof o.price === "number" && Number.isFinite(o.price) ? Math.max(0, o.price) : 0,
          };
        })
        .filter((x): x is LocalOrderRecord["items"][number] => x !== null)
    : [];
  if (items.length === 0) return null;
  return {
    reference,
    createdAt,
    total: typeof r.total === "number" && Number.isFinite(r.total) ? Math.max(0, r.total) : 0,
    itemCount: typeof r.itemCount === "number" ? r.itemCount : items.length,
    items: items.slice(0, MAX_CART_ITEMS),
  };
}

type CartState = {
  items: CartItem[];
  orders: LocalOrderRecord[];
  addItem: (productId: string, gameId: string) => AddItemResult;
  removeItem: (id: string) => void;
  updateRecipient: (id: string, patch: Partial<CartRecipient>) => void;
  /** Replace an item's recipient wholesale (validated upstream). */
  setRecipient: (id: string, recipient: CartRecipient) => void;
  clearItems: () => void;
  addOrderRecord: (record: LocalOrderRecord) => void;
  clearOrderHistory: () => void;
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      orders: [],

      addItem(productId, gameId) {
        const current = get().items;
        if (current.length >= MAX_CART_ITEMS) {
          return { ok: false, reason: "full" };
        }
        const item: CartItem = {
          id: newId(),
          productId,
          gameId,
          addedAt: new Date().toISOString(),
          recipient: emptyRecipient(),
        };
        set({ items: [...current, item] });
        return { ok: true, id: item.id };
      },

      removeItem(id) {
        set({ items: get().items.filter((it) => it.id !== id) });
      },

      updateRecipient(id, patch) {
        set({
          items: get().items.map((it) =>
            it.id === id ? { ...it, recipient: { ...it.recipient, ...patch } } : it
          ),
        });
      },

      setRecipient(id, recipient) {
        set({
          items: get().items.map((it) => (it.id === id ? { ...it, recipient } : it)),
        });
      },

      clearItems() {
        set({ items: [] });
      },

      addOrderRecord(record) {
        set({ orders: [record, ...get().orders].slice(0, MAX_ORDER_HISTORY) });
      },

      clearOrderHistory() {
        set({ orders: [] });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => (safeLocalStorage() ?? undefined) as Storage),
      version: 1,
      partialize: (s) => ({ items: s.items, orders: s.orders }),
      merge: (persisted, current) => {
        const p = persisted as Partial<Pick<CartState, "items" | "orders">> | undefined;
        const items = Array.isArray(p?.items)
          ? p.items
              .map(sanitizeItem)
              .filter((x): x is CartItem => x !== null)
              .slice(0, MAX_CART_ITEMS)
          : [];
        const orders = Array.isArray(p?.orders)
          ? p.orders
              .map(sanitizeOrder)
              .filter((x): x is LocalOrderRecord => x !== null)
              .slice(0, MAX_ORDER_HISTORY)
          : [];
        return { ...current, items, orders };
      },
    }
  )
);

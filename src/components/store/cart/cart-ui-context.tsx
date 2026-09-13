"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useCatalog } from "@/lib/queries";
import { useCartReconcile } from "@/lib/cart/resolve";
import { CartDrawer } from "./cart-drawer";

type CartUI = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const CartUIContext = createContext<CartUI>({ open: false, setOpen: () => {} });

export function useCartUI(): CartUI {
  return useContext(CartUIContext);
}

/**
 * Storefront cart scope: owns the drawer open state, keeps the cart
 * reconciled against fresh catalog data, and renders the drawer once
 * so every storefront view (home, games, game detail, help) shares it.
 */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { data } = useCatalog();
  useCartReconcile(data);

  const value = useMemo(() => ({ open, setOpen }), [open]);

  return (
    <CartUIContext.Provider value={value}>
      {children}
      <CartDrawer open={open} onOpenChange={setOpen} />
    </CartUIContext.Provider>
  );
}

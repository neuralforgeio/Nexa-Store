"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Ban, Skull } from "lucide-react";

/**
 * Full-blocking modal shown to an Admin whose access was revoked by the
 * Developer (D8). Deliberately dark and alarming: skull + block icon,
 * the Developer's reason, and no way further into the panel.
 *
 * Rendered both when a blocked Admin tries to log in (403 from /api/auth/login)
 * and when an active Admin session is revoked mid-dashboard (session endpoint
 * reports the block on its next poll).
 */
export function BlockedAdminDialog({
  open,
  onOpenChange,
  reason,
  onAcknowledge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason?: string | null;
  onAcknowledge?: () => void;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby="blocked-admin-description"
        className="gap-0 overflow-hidden rounded-2xl border-[oklch(0.45_0.16_25_/_0.6)] bg-[oklch(0.165_0.015_25)] p-0 text-[oklch(0.93_0.01_25)] shadow-[0_24px_80px_-16px_oklch(0.45_0.19_25_/_0.45)] sm:max-w-md"
      >
        {/* Ominous backdrop: red vignette + diagonal hazard lines. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,oklch(0.32_0.12_25_/_0.35),transparent_60%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[repeating-linear-gradient(-45deg,oklch(0.55_0.19_25)_0_14px,transparent_14px_28px)] opacity-80"
        />

        <div className="relative px-6 pb-6 pt-9 text-center">
          {/* Skull + block badge */}
          <div className="relative mx-auto w-fit">
            <span
              aria-hidden="true"
              className="absolute -inset-5 rounded-full bg-[radial-gradient(closest-side,oklch(0.55_0.19_25_/_0.4),transparent)]"
              style={
                reducedMotion
                  ? undefined
                  : { animation: "blocked-pulse 2.2s ease-in-out infinite" }
              }
            />
            <motion.span
              initial={reducedMotion ? false : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 16 }}
              className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-[oklch(0.45_0.16_25_/_0.55)] bg-[oklch(0.24_0.05_25)] text-[oklch(0.78_0.15_25)] shadow-[inset_0_1px_0_oklch(0.4_0.08_25),0_10px_30px_-10px_oklch(0.5_0.19_25_/_0.5)]"
            >
              <Skull aria-hidden="true" className="h-10 w-10" />
            </motion.span>
            <motion.span
              initial={reducedMotion ? false : { scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.18, type: "spring", stiffness: 300, damping: 15 }}
              className="absolute -bottom-2 -right-2 flex h-9 w-9 items-center justify-center rounded-xl border border-[oklch(0.5_0.17_25_/_0.6)] bg-[oklch(0.36_0.16_25)] text-white shadow-lg"
            >
              <Ban aria-hidden="true" className="h-5 w-5" />
            </motion.span>
          </div>

          <DialogHeader className="items-center">
            <DialogTitle className="mt-5 font-display text-xl font-bold uppercase tracking-[0.12em] text-[oklch(0.72_0.16_25)]">
              Akun Diblokir
            </DialogTitle>
            <DialogDescription
              id="blocked-admin-description"
              className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-[oklch(0.72_0.015_25)]"
            >
              Akses Admin telah diblokir sepenuhnya oleh Developer. Sesi kamu
              langsung dicabut dan semua fitur panel dinonaktifkan.
            </DialogDescription>
          </DialogHeader>

          {/* The Developer's reason */}
          <div className="mt-5 rounded-xl border border-[oklch(0.45_0.16_25_/_0.45)] bg-[oklch(0.22_0.04_25_/_0.8)] p-4 text-left">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[oklch(0.66_0.14_25)]">
              Alasan pemblokiran
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[oklch(0.88_0.02_25)]">
              {reason?.trim()
                ? `“${reason.trim()}”`
                : "Developer tidak mencantumkan alasan. Hubungi Developer untuk klarifikasi."}
            </p>
          </div>

          <DialogFooter className="mt-6 flex-col items-stretch gap-2 sm:mx-auto sm:w-56 sm:flex-col">
            <Button
              type="button"
              onClick={() => {
                onAcknowledge?.();
                onOpenChange(false);
              }}
              className="w-full gap-2 bg-[oklch(0.55_0.19_25)] font-semibold text-white hover:bg-[oklch(0.48_0.18_25)]"
            >
              <Ban aria-hidden="true" className="h-4 w-4" />
              Saya mengerti
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

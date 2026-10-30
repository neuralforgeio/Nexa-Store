"use client";

import { useState } from "react";
import { Check, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Kustomisasi tema warna toko (v1.21.0).
 *
 * Palet dipilih → atribut `data-palette` dipasang di <html> → blok CSS di
 * globals.css menimpa token aksen (primary, ring, accent, glow) untuk mode
 * terang dan gelap sekaligus. Amber adalah bawaan (tanpa atribut). Skrip
 * inline di layout memasang atribut ini SEBELUM paint pertama supaya tidak
 * ada kedipan warna saat halaman dimuat ulang.
 */

export const PALETTE_IDS = ["amber", "emerald", "violet", "rose", "sunset"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

const STORAGE_KEY = "nexa-palette";

const SWATCHES: Record<PaletteId, string> = {
  amber: "oklch(0.78 0.15 70)",
  emerald: "oklch(0.72 0.14 163)",
  violet: "oklch(0.65 0.16 300)",
  rose: "oklch(0.7 0.16 15)",
  sunset: "oklch(0.75 0.16 45)",
};

const PALETTE_META: Array<{ id: PaletteId; label: string }> = [
  { id: "amber", label: "Amber" },
  { id: "emerald", label: "Emerald" },
  { id: "violet", label: "Violet" },
  { id: "rose", label: "Rose" },
  { id: "sunset", label: "Sunset" },
];

const PALETTES: Array<{ id: PaletteId; label: string; swatch: string }> = PALETTE_META.map(
  (p) => ({ ...p, swatch: SWATCHES[p.id] })
);

function isPaletteId(v: string | null): v is PaletteId {
  return v !== null && (PALETTE_IDS as readonly string[]).includes(v);
}

/** Palet aktif dibaca dari atribut DOM (dipasang skrip anti-flash di layout
 *  SEBELUM paint) — bukan dari state effect. Saat SSR atribut belum ada →
 *  amber; popover tertutup saat hidrasi sehingga tidak ada mismatch. */
function readInitialPalette(): PaletteId {
  if (typeof document === "undefined") return "amber";
  const v = document.documentElement.getAttribute("data-palette");
  return isPaletteId(v) ? v : "amber";
}

export function applyPalette(id: PaletteId): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (id === "amber") el.removeAttribute("data-palette");
  else el.setAttribute("data-palette", id);
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // storage bisa diblokir — atribut tetap terpasang untuk sesi ini
  }
}

export function PalettePicker({ className }: { className?: string }) {
  const [active, setActive] = useState<PaletteId>(readInitialPalette);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Pilih warna toko"
          title="Warna toko"
          className={cn("h-9 w-9 rounded-full", className)}
        >
          <Palette aria-hidden="true" className="h-4.5 w-4.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-56 p-3">
        <p className="px-1 pb-0.5 font-display text-sm font-semibold">Warna Toko</p>
        <p className="px-1 pb-3 text-[11px] leading-relaxed text-muted-foreground">
          Ganti warna aksen seluruh toko — tersimpan di perangkatmu.
        </p>
        <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Pilihan warna toko">
          {PALETTES.map(({ id, label, swatch }) => {
            const isActive = active === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={isActive}
                aria-label={`${label}${isActive ? " (aktif)" : ""}`}
                title={label}
                onClick={() => {
                  setActive(id);
                  applyPalette(id);
                }}
                className={cn(
                  "relative flex h-9 w-full items-center justify-center rounded-xl border transition-all duration-150",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95",
                  isActive
                    ? "border-primary/60 shadow-[var(--glow-primary)]"
                    : "border-border hover:border-primary/40"
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-5 w-5 rounded-full border border-black/10 shadow-inner"
                  style={{ background: swatch }}
                />
                {isActive ? (
                  <Check
                    aria-hidden="true"
                    className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-primary p-0.5 text-primary-foreground"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="px-1 pt-2.5 text-[10px] text-muted-foreground/70">
          Amber adalah warna bawaan Nexa Store.
        </p>
      </PopoverContent>
    </Popover>
  );
}

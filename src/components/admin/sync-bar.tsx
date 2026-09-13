"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCatalogMutation, type ManagementCatalog } from "@/lib/queries";
import { ApiError } from "@/lib/api-client";
import type { Product, Game, Category } from "@/lib/catalog/types";
import { productTitle } from "@/lib/whatsapp/template";
import { formatIdr } from "@/lib/format/idr";
import { formatWib } from "@/lib/format/date";
import { toast } from "sonner";
import { CloudUpload, Loader2, Undo2, GitCompareArrows } from "lucide-react";

export type CatalogDrafts = {
  games?: Game[];
  products?: Product[];
  categories?: Category[];
};

/**
 * Sync boundary for management views (PRD §33 state machine, §34 no optimistic claims).
 * IDLE → DIRTY (drafts exist) → SYNCING → SUCCESS | CONFLICT | ERROR.
 */
export function SyncBar({
  base,
  drafts,
  onDiscard,
  onSynced,
}: {
  base: ManagementCatalog;
  drafts: CatalogDrafts;
  onDiscard: () => void;
  onSynced: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const mutation = useCatalogMutation();

  const diff = useMemo(() => computeDiff(base, drafts), [base, drafts]);
  const dirty = diff.total > 0;
  const adapterLabel = base.adapter === "github" ? "GitHub" : "mode lokal";

  const buildOperations = () => {
    const ops: Array<Record<string, unknown>> = [];
    if (drafts.games) {
      const byId = new Map(base.games.map((g) => [g.id, g]));
      for (const g of drafts.games) {
        if (!byId.has(g.id)) ops.push({ type: "game.create", payload: g });
        else if (JSON.stringify(byId.get(g.id)) !== JSON.stringify(g))
          ops.push({ type: "game.update", id: g.id, payload: g });
      }
    }
    if (drafts.products) {
      const byId = new Map(base.products.map((p) => [p.id, p]));
      for (const p of drafts.products) {
        if (!byId.has(p.id)) ops.push({ type: "product.create", payload: p });
        else if (JSON.stringify(byId.get(p.id)) !== JSON.stringify(p))
          ops.push({ type: "product.update", id: p.id, payload: p });
      }
    }
    if (drafts.categories) {
      const byId = new Map(base.categories.map((c) => [c.id, c]));
      for (const c of drafts.categories) {
        if (!byId.has(c.id)) ops.push({ type: "category.create", payload: c });
        else if (JSON.stringify(byId.get(c.id)) !== JSON.stringify(c))
          ops.push({ type: "category.update", id: c.id, payload: c });
      }
    }
    return ops;
  };

  const sync = async () => {
    const operations = buildOperations();
    if (operations.length === 0) {
      setPreviewOpen(false);
      return;
    }
    try {
      const result = await mutation.mutateAsync({
        baseRevision: base.revision,
        baseFileShas: base.fileShas,
        operations,
      });
      setPreviewOpen(false);
      toast.success("Perubahan tersimpan dan dikirim ke penyimpanan", {
        description: `${result.commitMessage} · ${result.files.join(", ")} · revisi ${result.revision.slice(0, 12)}`,
        duration: 7000,
      });
      onSynced();
    } catch (e) {
      if (e instanceof ApiError && e.code === "repo.conflict") {
        toast.error("Konflik data terdeteksi", {
          description: "Data berubah sejak halaman ini dibuka. Muat ulang data sebelum menyimpan lagi.",
          duration: 10000,
        });
      } else if (e instanceof ApiError) {
        toast.error("Gagal menyimpan", { description: e.message });
      } else {
        toast.error("Gagal menyimpan", { description: "Perubahan tidak tersimpan. Coba lagi." });
      }
    }
  };

  return (
    <div className="sticky bottom-0 z-30 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {mutation.isPending
            ? "Menyinkronkan…"
            : dirty
              ? `${diff.total} perubahan belum disinkronkan`
              : `Tersinkron dengan ${adapterLabel} · revisi ${base.revision.slice(0, 12)}`}
        </p>
        <div className="ml-auto flex gap-2">
          {dirty ? (
            <>
              <Button variant="ghost" size="sm" onClick={onDiscard} disabled={mutation.isPending}>
                <Undo2 aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
                Buang draft
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)} disabled={mutation.isPending}>
                <GitCompareArrows aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
                Pratinjau
              </Button>
              <Button size="sm" onClick={() => void sync()} disabled={mutation.isPending}>
                {mutation.isPending ? (
                  <Loader2 aria-hidden="true" className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CloudUpload aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
                )}
                Sinkronkan
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Pratinjau perubahan</DialogTitle>
            <DialogDescription>
              Perubahan ditulis sebagai satu commit{" "}
              ({adapterLabel}) setelah Anda konfirmasi.
            </DialogDescription>
          </DialogHeader>
          <div className="scroll-slim max-h-72 space-y-3 overflow-y-auto rounded-md border bg-card/50 p-4 text-sm">
            <p className="text-muted-foreground">
              Game berubah: {diff.gamesChanged} · Produk berubah: {diff.productsChanged} · Kategori
              berubah: {diff.categoriesChanged}
            </p>
            {diff.lines.length > 0 ? (
              <ul className="space-y-1 font-mono text-xs">
                {diff.lines.map((line, i) => (
                  <li key={i} className="text-foreground/85">
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Detail ringkas tidak tersedia untuk perubahan ini.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(false)} disabled={mutation.isPending}>
              Batal
            </Button>
            <Button size="sm" onClick={() => void sync()} disabled={mutation.isPending}>
              {mutation.isPending ? (
                <Loader2 aria-hidden="true" className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Konfirmasi &amp; sinkronkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function computeDiff(base: ManagementCatalog, drafts: CatalogDrafts) {
  const lines: string[] = [];
  let gamesChanged = 0;
  let productsChanged = 0;
  let categoriesChanged = 0;

  if (drafts.games) {
    const byId = new Map(base.games.map((g) => [g.id, g]));
    for (const g of drafts.games) {
      const old = byId.get(g.id);
      if (!old) {
        gamesChanged++;
        lines.push(`+ Game ${g.name} baru`);
      } else if (JSON.stringify(old) !== JSON.stringify(g)) {
        gamesChanged++;
        if (old.enabled !== g.enabled)
          lines.push(`Game ${g.name}: ${g.enabled ? "diaktifkan" : "dinonaktifkan"}`);
        if (old.name !== g.name) lines.push(`Game: ${old.name} → ${g.name}`);
        if (old.orderFieldSchema.length !== g.orderFieldSchema.length)
          lines.push(`Game ${g.name}: field pesanan berubah`);
      }
    }
  }

  if (drafts.products) {
    const byId = new Map(base.products.map((p) => [p.id, p]));
    for (const p of drafts.products) {
      const old = byId.get(p.id);
      if (!old) {
        productsChanged++;
        lines.push(`+ ${productTitle(p)}: ${formatIdr(p.priceIdr)} (baru)`);
      } else if (JSON.stringify(old) !== JSON.stringify(p)) {
        productsChanged++;
        if (old.priceIdr !== p.priceIdr)
          lines.push(`${productTitle(p)}: ${formatIdr(old.priceIdr)} → ${formatIdr(p.priceIdr)}`);
        if (old.enabled !== p.enabled)
          lines.push(`${productTitle(p)}: ${p.enabled ? "diaktifkan" : "dinonaktifkan"}`);
        if (old.denomination !== p.denomination)
          lines.push(`${old.denomination} ${old.name} → ${productTitle(p)}`);
      }
    }
  }

  if (drafts.categories) {
    const byId = new Map(base.categories.map((c) => [c.id, c]));
    for (const c of drafts.categories) {
      const old = byId.get(c.id);
      if (!old) {
        categoriesChanged++;
        lines.push(`+ Kategori ${c.name} baru`);
      } else if (JSON.stringify(old) !== JSON.stringify(c)) {
        categoriesChanged++;
        lines.push(`Kategori ${c.name} diperbarui`);
      }
    }
  }

  return { lines, gamesChanged, productsChanged, categoriesChanged, total: gamesChanged + productsChanged + categoriesChanged };
}

export { formatWib };

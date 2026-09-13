"use client";

import { useMemo, useState } from "react";
import { useSettingsBundle, useSettingsMutation } from "@/lib/queries";
import { useCatalog } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadingState, ErrorState } from "@/components/shared/state-views";
import { ApiError } from "@/lib/api-client";
import { CHECKOUT_PLACEHOLDERS } from "@/lib/whatsapp/template";
import { formatWib } from "@/lib/format/date";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

/** Checkout template editor (PRD §16.4, §37) — Admin edits text, never logic. */
export function AdminCheckout() {
  const { data, isPending, isError, refetch } = useSettingsBundle(true);
  const catalog = useCatalog();
  const mutation = useSettingsMutation();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const template = draft ?? data?.checkoutTemplate.template ?? "";

  const preview = useMemo(() => {
    if (!catalog.data) return "";
    const game = catalog.data.games[0];
    const product = catalog.data.products.find((p) => game && p.gameId === game.id);
    if (!game || !product) return "";
    const sampleFields = Object.fromEntries(
      game.orderFields.map((f) => [f.key, f.type === "number" ? "12345678" : "PlayerName#1234"])
    );
    try {
      const ctx = {
        storeName: catalog.data.store.name,
        gameName: game.name,
        productName: `${product.denomination} ${product.name}`,
        price: new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(product.priceIdr),
        customerName: "Budi",
        playerId: sampleFields["playerId"] ?? "",
        serverId: sampleFields["serverId"] ?? "",
        note: "—",
        orderDetails: game.orderFields.map((f) => `${f.label}: ${sampleFields[f.key]}`).join("\n") || "—",
        timestamp: formatWib(),
      };
      return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_all, name: string) => {
        if (!(CHECKOUT_PLACEHOLDERS as readonly string[]).includes(name)) return `{${name}⚠}`;
        return (ctx as Record<string, string>)[name] ?? "";
      });
    } catch {
      return "Pratinjau tidak tersedia.";
    }
  }, [template, catalog.data]);

  if (isPending) return <LoadingState label="Memuat template…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Template tidak dapat dimuat"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  const dirty = draft !== null && draft !== data.checkoutTemplate.template;

  const insertPlaceholder = (name: string) => {
    setDraft((prev) => `${prev ?? template}{${name}}`);
  };

  const submit = async () => {
    setError(null);
    try {
      const result = await mutation.mutateAsync({
        baseRevision: data.revision,
        baseFileShas: data.fileShas,
        settings: data.settings,
        checkoutTemplate: { template },
      });
      setDraft(null);
      toast.success("Template tersimpan", {
        description: `${result.commitMessage} · revisi ${result.revision.slice(0, 12)}`,
      });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "repo.conflict") {
          toast.error("Konflik data terdeteksi", {
            description: "Data berubah sejak halaman dibuka. Muat ulang lalu coba lagi.",
            duration: 10000,
          });
        }
        setError(e.message);
      } else {
        setError("Gagal menyimpan template.");
      }
    }
  };

  return (
    <div className="pb-24">
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight">Template pesanan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Teks pesan WhatsApp yang tersusun otomatis saat pelanggan memesan. Placeholder ditulis
          dalam kurung kurawal.
        </p>
      </header>

      <div className="mt-6 grid max-w-3xl gap-5">
        <div className="space-y-1.5">
          <Label htmlFor="t-body">Template</Label>
          <Textarea
            id="t-body"
            rows={12}
            value={template}
            onChange={(e) => setDraft(e.target.value)}
            className="scroll-slim font-mono text-xs leading-relaxed"
            aria-describedby="t-help"
          />
          <p id="t-help" className="text-xs text-muted-foreground">
            Placeholder tak dikenal akan ditandai ⚠ di pratinjau dan ditolak saat disimpan.
          </p>
          {error ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Sisipkan placeholder</p>
          <div className="flex flex-wrap gap-1.5">
            {CHECKOUT_PLACEHOLDERS.map((name) => (
              <Button
                key={name}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full px-2.5 font-mono text-[11px]"
                onClick={() => insertPlaceholder(name)}
              >
                {`{${name}}`}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Pratinjau (contoh dengan {catalog.data?.games[0]?.name ?? "game pertama"})
          </p>
          <pre className="scroll-slim whitespace-pre-wrap rounded-lg border bg-card/50 p-3 font-mono text-xs leading-relaxed">
            {preview}
          </pre>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 mt-8 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {mutation.isPending
              ? "Menyimpan…"
              : data.checkoutTemplate.updatedAt
                ? `Terakhir diubah ${formatWib(new Date(data.checkoutTemplate.updatedAt))}`
                : dirty
                  ? "Ada perubahan belum disimpan"
                  : "Tersimpan"}
          </p>
          <div className="flex gap-2">
            {dirty ? (
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={mutation.isPending}>
                Buang perubahan
              </Button>
            ) : null}
            <Button size="sm" onClick={() => void submit()} disabled={!dirty || mutation.isPending}>
              {mutation.isPending ? (
                <Loader2 aria-hidden="true" className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
              )}
              Simpan template
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

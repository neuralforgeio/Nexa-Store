"use client";

import { useMemo, useState } from "react";
import { useDataInspector } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingState, ErrorState, EmptyState } from "@/components/shared/state-views";
import { formatWib } from "@/lib/format/date";
import { Download, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

const FILE_LABELS: Record<string, string> = {
  games: "games.json",
  products: "products.json",
  categories: "categories.json",
  settings: "settings.json",
  "checkout-template": "checkout-template.json",
};

/** Data Inspector (PRD §17.2) — read + search + copy. Raw editing via import lives in Deployment/Diagnostics tooling. */
export function DevData() {
  const { data, isPending, isError, refetch, isFetching, dataUpdatedAt } = useDataInspector(true);
  const [query, setQuery] = useState("");
  const [activeFile, setActiveFile] = useState<string>("products");

  const files = useMemo(() => (data ? Object.keys(data.files) : []), [data]);

  const rendered = useMemo(() => {
    if (!data) return "";
    const raw = data.files[activeFile];
    if (raw === undefined || raw === null) return "(kosong)";
    const text = JSON.stringify(raw, null, 2);
    if (!query.trim()) return text;
    const q = query.trim().toLowerCase();
    return text
      .split("\n")
      .filter((line) => line.toLowerCase().includes(q))
      .join("\n");
  }, [data, activeFile, query]);

  if (isPending) return <LoadingState label="Memuat data…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Data tidak dapat dibaca"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data.files[activeFile], null, 2));
      toast.success("JSON disalin", { description: FILE_LABELS[activeFile] });
    } catch {
      toast.error("Gagal menyalin");
    }
  };

  const exportAll = () => {
    const blob = new Blob([JSON.stringify(data.files, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nexa-store-data-${data.revision.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Ekspor diunduh");
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Data Inspector</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Berkas kanonik dalam bentuk ternormalisasi · revisi{" "}
            <span className="font-mono">{data.revision.slice(0, 12)}</span> ·{" "}
            {dataUpdatedAt ? formatWib(new Date(dataUpdatedAt)) : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw aria-hidden="true" className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportAll}>
            <Download aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
            Ekspor JSON
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="scroll-slim flex gap-1 overflow-x-auto">
          {files.map((file) => (
            <button
              key={file}
              type="button"
              onClick={() => setActiveFile(file)}
              aria-pressed={activeFile === file}
              className={`shrink-0 rounded-md border px-3 py-1.5 font-mono text-xs transition-colors ${
                activeFile === file
                  ? "border-primary/60 bg-primary/12 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {FILE_LABELS[file] ?? file}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search aria-hidden="true" className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter baris…"
            aria-label="Filter baris JSON"
            className="h-8 w-44 pl-8"
          />
        </div>
      </div>

      {data.validation.ok ? (
        <p className="text-xs text-muted-foreground">Validasi: lolos.</p>
      ) : (
        <ul className="scroll-slim max-h-24 space-y-1 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/6 p-3 text-xs text-destructive">
          {data.validation.issues.slice(0, 10).map((issue, i) => (
            <li key={i} className="font-mono">
              {issue.file}
              {issue.recordId ? `/${issue.recordId}` : ""}
              {issue.field ? `.${issue.field}` : ""}: {issue.reason}
            </li>
          ))}
        </ul>
      )}

      {rendered.trim().length === 0 ? (
        <EmptyState title="Tidak ada baris yang cocok" description={`Filter "${query}" tidak menemukan baris di ${FILE_LABELS[activeFile]}.`} />
      ) : (
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            className="absolute right-3 top-3 h-7 text-xs"
            onClick={() => void copy()}
          >
            Salin JSON
          </Button>
          <pre className="scroll-slim max-h-[52vh] overflow-auto rounded-lg border bg-card/40 p-4 font-mono text-xs leading-relaxed">
            {rendered}
          </pre>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        SHA berkas saat ini:{" "}
        <span className="font-mono">{data.fileShas[activeFile]?.slice(0, 16) ?? "—"}</span>
      </p>
    </div>
  );
}

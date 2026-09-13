"use client";

import { useMemo, useState } from "react";
import { useManagementCatalog } from "@/lib/queries";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GameMark } from "@/components/shared/game-mark";
import { LoadingState, ErrorState, EmptyState } from "@/components/shared/state-views";
import { SyncBar } from "./sync-bar";
import type { Product } from "@/lib/catalog/types";
import { parseIdrInput, formatIdr } from "@/lib/format/idr";
import { cn } from "@/lib/utils";
import { Plus, Search, Pencil, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";

type DraftState = { products: Product[] };

export function AdminProducts() {
  const { data, isPending, isError, refetch } = useManagementCatalog(true);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [gameFilter, setGameFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);

  const working = draft?.products ?? data?.products ?? [];

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...working]
      .sort((a, b) => (a.gameId === b.gameId ? a.sortOrder - b.sortOrder : a.gameId.localeCompare(b.gameId)))
      .filter((p) => (gameFilter === "all" ? true : p.gameId === gameFilter))
      .filter((p) => {
        if (!q) return true;
        const gameName = data?.games.find((g) => g.id === p.gameId)?.name ?? "";
        return (
          p.name.toLowerCase().includes(q) ||
          p.denomination.toLowerCase().includes(q) ||
          (p.bonus ?? "").toLowerCase().includes(q) ||
          gameName.toLowerCase().includes(q)
        );
      });
  }, [working, gameFilter, search, data]);

  if (isPending) return <LoadingState label="Memuat produk…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Produk tidak dapat dimuat"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  const setProducts = (updater: (products: Product[]) => Product[]) => {
    setDraft((prev) => ({ products: updater(prev?.products ?? data.products) }));
  };

  const moveProduct = (id: string, direction: -1 | 1) => {
    setProducts((products) => {
      const next = [...products];
      const index = next.findIndex((p) => p.id === id);
      if (index === -1) return next;
      const current = next[index];
      const siblings = next
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.gameId === current.gameId)
        .sort((a, b) => a.p.sortOrder - b.p.sortOrder);
      const pos = siblings.findIndex((s) => s.i === index);
      const neighbor = siblings[pos + direction];
      if (!neighbor) return next;
      const tmp = current.sortOrder;
      next[index] = { ...current, sortOrder: neighbor.p.sortOrder };
      next[neighbor.i] = { ...neighbor.p, sortOrder: tmp };
      return next;
    });
  };

  const upsertProduct = (product: Product) => {
    setProducts((products) => {
      const index = products.findIndex((p) => p.id === product.id);
      if (index === -1) return [...products, product];
      const next = [...products];
      next[index] = product;
      return next;
    });
  };

  return (
    <div className="pb-20">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Produk</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {working.filter((p) => p.enabled).length} aktif · {working.filter((p) => !p.enabled).length} nonaktif
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
          Produk baru
        </Button>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search aria-hidden="true" className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari produk…"
            aria-label="Cari produk"
            className="h-9 w-56 pl-8"
          />
        </div>
        <Select value={gameFilter} onValueChange={setGameFilter}>
          <SelectTrigger className="h-9 w-44" aria-label="Filter game">
            <SelectValue placeholder="Semua game" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua game</SelectItem>
            {data.games.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {visible.length === 0 ? (
        <EmptyState className="mt-4" title="Tidak ada produk yang cocok" description="Ubah filter atau pencarian." />
      ) : (
        <div className="scroll-slim mt-4 max-h-[60vh] overflow-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Nominal</TableHead>
                <TableHead className="text-right">Harga</TableHead>
                <TableHead className="text-center">Aktif</TableHead>
                <TableHead className="w-24 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((p) => {
                const game = data.games.find((g) => g.id === p.gameId);
                return (
                  <TableRow key={p.id} className={cn(!p.enabled && "opacity-55")}>
                    <TableCell>
                      <GameMark name={game?.name ?? "?"} image={game?.image} size="sm" />
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">
                        {p.denomination} {p.name}
                        {p.bonus ? <span className="text-primary"> {p.bonus}</span> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {game?.name ?? "game?"} · id <span className="font-mono">{p.id}</span>
                        {p.note ? ` · ${p.note}` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular">{formatIdr(p.priceIdr)}</TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={p.enabled}
                        aria-label={`${p.enabled ? "Nonaktifkan" : "Aktifkan"} ${p.denomination} ${p.name}`}
                        onCheckedChange={(checked) => upsertProduct({ ...p, enabled: checked })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Naikkan urutan" onClick={() => moveProduct(p.id, -1)}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Turunkan urutan" onClick={() => moveProduct(p.id, 1)}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Ubah ${p.denomination} ${p.name}`} onClick={() => setEditing(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ProductEditor
        editing={editing}
        games={data.games}
        onClose={() => setEditing(null)}
        onSave={(product) => {
          upsertProduct(product);
          setEditing(null);
          toast.info("Draft ditambahkan", { description: "Perubahan belum tersimpan. Sinkronkan lewat tombol di bawah." });
        }}
        existingIds={new Set(working.map((p) => p.id))}
      />

      <SyncBar
        base={data}
        drafts={draft ?? {}}
        onDiscard={() => setDraft(null)}
        onSynced={() => {
          setDraft(null);
          qc.invalidateQueries({ queryKey: ["mgmt-catalog"] });
        }}
      />
    </div>
  );
}

function ProductEditor({
  editing,
  games,
  existingIds,
  onClose,
  onSave,
}: {
  editing: Product | "new" | null;
  games: ReturnType<typeof useManagementCatalog>["data"] extends infer T ? T extends { games: infer G } ? G : never : never;
  existingIds: Set<string>;
  onClose: () => void;
  onSave: (product: Product) => void;
}) {
  const isNew = editing === "new";
  const current = isNew ? null : editing;
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [denomination, setDenomination] = useState("");
  const [bonus, setBonus] = useState("");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [gameId, setGameId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const key = isNew ? "new" : current?.id ?? null;
  if (key && initializedFor !== key) {
    setInitializedFor(key);
    setErrors({});
    if (isNew) {
      setId("");
      setName("");
      setDenomination("");
      setBonus("");
      setPrice("");
      setNote("");
      setGameId(games[0]?.id ?? "");
      setEnabled(true);
    } else if (current) {
      setId(current.id);
      setName(current.name);
      setDenomination(current.denomination);
      setBonus(current.bonus ?? "");
      setPrice(String(current.priceIdr));
      setNote(current.note ?? "");
      setGameId(current.gameId);
      setEnabled(current.enabled);
    }
  }

  const submit = () => {
    const errs: Record<string, string> = {};
    const trimmedId = id.trim() || `${gameId}-${denomination.trim().replace(/\s+/g, "-").toLowerCase()}`;
    if (!name.trim()) errs.name = "Nama wajib diisi";
    if (!denomination.trim()) errs.denomination = "Nominal wajib diisi";
    if (!isNew && existingIds.has(trimmedId) && trimmedId !== current?.id) errs.id = "ID sudah dipakai produk lain";
    if (isNew && existingIds.has(trimmedId)) errs.id = "ID sudah dipakai produk lain";
    if (!gameId) errs.gameId = "Pilih game";
    const parsed = parseIdrInput(price);
    if (parsed === null) errs.price = "Harga harus angka bulat Rupiah (mis. 56000)";
    else if (enabled && parsed <= 0) errs.price = "Produk aktif butuh harga positif";
    setErrors(errs);
    if (Object.keys(errs).length > 0 || parsed === null) return;

    onSave({
      id: trimmedId,
      gameId,
      name: name.trim(),
      denomination: denomination.trim(),
      bonus: bonus.trim() || undefined,
      priceIdr: parsed,
      currency: "IDR",
      enabled,
      sortOrder: current?.sortOrder ?? parsed,
      note: note.trim() || undefined,
    });
  };

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto scroll-slim">
        <DialogHeader>
          <DialogTitle className="font-display">{isNew ? "Produk baru" : `Ubah ${current?.denomination} ${current?.name}`}</DialogTitle>
          <DialogDescription>Perubahan masuk draft sampai disinkronkan.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-game">Game</Label>
              <Select value={gameId} onValueChange={setGameId}>
                <SelectTrigger id="p-game" aria-invalid={errors.gameId ? true : undefined}>
                  <SelectValue placeholder="Pilih game" />
                </SelectTrigger>
                <SelectContent>
                  {games.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.gameId ? <p role="alert" className="text-xs text-destructive">{errors.gameId}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-denomination">Nominal</Label>
              <Input id="p-denomination" value={denomination} onChange={(e) => setDenomination(e.target.value)} placeholder="475" aria-invalid={errors.denomination ? true : undefined} />
              {errors.denomination ? <p role="alert" className="text-xs text-destructive">{errors.denomination}</p> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">Nama mata uang</Label>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Points" aria-invalid={errors.name ? true : undefined} />
              {errors.name ? <p role="alert" className="text-xs text-destructive">{errors.name}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-bonus">Bonus (opsional)</Label>
              <Input id="p-bonus" value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="+ 30" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-price">Harga (Rupiah bulat)</Label>
            <Input id="p-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="56000" aria-invalid={errors.price ? true : undefined} />
            {price && parseIdrInput(price) !== null ? (
              <p className="text-xs text-muted-foreground">≈ {formatIdr(parseIdrInput(price) as number)}</p>
            ) : null}
            {errors.price ? <p role="alert" className="text-xs text-destructive">{errors.price}</p> : null}
          </div>

          {!isNew ? (
            <div className="space-y-1.5">
              <Label htmlFor="p-id">ID</Label>
              <Input id="p-id" value={id} onChange={(e) => setId(e.target.value)} className="font-mono text-xs" aria-invalid={errors.id ? true : undefined} />
              {errors.id ? <p role="alert" className="text-xs text-destructive">{errors.id}</p> : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="p-note">Catatan (opsional)</Label>
            <Textarea id="p-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <Label htmlFor="p-enabled">Tampilkan di storefront</Label>
            <Switch id="p-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Batal</Button>
          <Button size="sm" onClick={submit}>Simpan draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

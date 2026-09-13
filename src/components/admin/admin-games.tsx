"use client";

import { useState } from "react";
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
import type { Game, OrderField } from "@/lib/catalog/types";
import { Plus, Pencil, ArrowUp, ArrowDown, Trash2, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";

/** Max stored icon size (data URI characters, ~192KB binary). */
const ICON_LIMIT_CHARS = 260_000;

/** Resize + square-crop an uploaded image into a compact data URI. */
async function fileToIconDataUri(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("File harus berupa gambar.");
  }
  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = document.createElement("img");
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Gambar tidak dapat dibaca."));
      img.src = bitmapUrl;
    });
    const target = 256;
    const min = Math.min(img.width, img.height);
    const sx = (img.width - min) / 2;
    const sy = (img.height - min) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = target;
    canvas.height = target;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Peramban tidak mendukung pemrosesan gambar.");
    ctx.drawImage(img, sx, sy, min, min, 0, 0, target, target);
    const webp = canvas.toDataURL("image/webp", 0.85);
    if (webp.length <= ICON_LIMIT_CHARS) return webp;
    const jpeg = canvas.toDataURL("image/jpeg", 0.8);
    if (jpeg.length > ICON_LIMIT_CHARS) {
      throw new Error("Gambar masih terlalu besar setelah dikompres. Pakai gambar lain.");
    }
    return jpeg;
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

type DraftState = { games: Game[] };

export function AdminGames() {
  const { data, isPending, isError, refetch } = useManagementCatalog(true);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [editing, setEditing] = useState<Game | "new" | null>(null);

  const working = draft?.games ?? data?.games ?? [];

  if (isPending) return <LoadingState label="Memuat game…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Data game tidak dapat dimuat"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  const setGames = (updater: (games: Game[]) => Game[]) => {
    setDraft((prev) => ({ games: updater(prev?.games ?? data.games) }));
  };

  const moveGame = (id: string, direction: -1 | 1) => {
    setGames((games) => {
      const sorted = [...games].sort((a, b) => a.sortOrder - b.sortOrder);
      const pos = sorted.findIndex((g) => g.id === id);
      const neighbor = sorted[pos + direction];
      if (!neighbor) return games;
      const a = games.findIndex((g) => g.id === id);
      const b = games.findIndex((g) => g.id === neighbor.id);
      const next = [...games];
      const tmp = next[a].sortOrder;
      next[a] = { ...next[a], sortOrder: next[b].sortOrder };
      next[b] = { ...next[b], sortOrder: tmp };
      return next;
    });
  };

  return (
    <div className="pb-20">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Game</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kelola daftar game, status, dan field data akun yang diminta saat pesanan.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
          Game baru
        </Button>
      </header>

      {working.length === 0 ? (
        <EmptyState className="mt-4" title="Belum ada game" description="Tambahkan game pertama Anda." />
      ) : (
        <div className="scroll-slim mt-4 max-h-[60vh] overflow-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Game</TableHead>
                <TableHead>Field pesanan</TableHead>
                <TableHead className="text-center">Aktif</TableHead>
                <TableHead className="w-24 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...working]
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((g) => (
                  <TableRow key={g.id} className={!g.enabled ? "opacity-55" : undefined}>
                    <TableCell>
                      <GameMark name={g.name} image={g.image} size="sm" />
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{g.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{g.slug}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-xs text-muted-foreground">
                        {g.orderFieldSchema.map((f) => `${f.label}${f.required ? "*" : ""}`).join(", ") || "—"}
                      </p>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={g.enabled}
                        aria-label={`${g.enabled ? "Nonaktifkan" : "Aktifkan"} ${g.name}`}
                        onCheckedChange={(checked) =>
                          setGames((games) => games.map((x) => (x.id === g.id ? { ...x, enabled: checked } : x)))
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Naikkan urutan" onClick={() => moveGame(g.id, -1)}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Turunkan urutan" onClick={() => moveGame(g.id, 1)}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Ubah ${g.name}`} onClick={() => setEditing(g)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}

      <GameEditor
        editing={editing}
        categories={data.categories}
        existingSlugs={new Set(working.map((g) => g.slug))}
        existingIds={new Set(working.map((g) => g.id))}
        onClose={() => setEditing(null)}
        onSave={(game) => {
          setGames((games) => {
            const index = games.findIndex((g) => g.id === game.id);
            if (index === -1) return [...games, game];
            const next = [...games];
            next[index] = game;
            return next;
          });
          setEditing(null);
          toast.info("Draft ditambahkan", { description: "Sinkronkan untuk menyimpan." });
        }}
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

function GameEditor({
  editing,
  categories,
  existingSlugs,
  existingIds,
  onClose,
  onSave,
}: {
  editing: Game | "new" | null;
  categories: Array<{ id: string; name: string; enabled: boolean }>;
  existingSlugs: Set<string>;
  existingIds: Set<string>;
  onClose: () => void;
  onSave: (game: Game) => void;
}) {
  const isNew = editing === "new";
  const current = isNew ? null : editing;
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<string | undefined>(undefined);
  const [enabled, setEnabled] = useState(true);
  const [sortOrder, setSortOrder] = useState("1");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [fields, setFields] = useState<OrderField[]>([]);
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const key = isNew ? "new" : current?.id ?? null;
  if (key && initializedFor !== key) {
    setInitializedFor(key);
    setErrors({});
    if (isNew) {
      setName("");
      setSlug("");
      setDescription("");
      setImage(undefined);
      setEnabled(true);
      setSortOrder("1");
      setCategoryIds([]);
      setFields([]);
    } else if (current) {
      setName(current.name);
      setSlug(current.slug);
      setDescription(current.description ?? "");
      setImage(current.image);
      setEnabled(current.enabled);
      setSortOrder(String(current.sortOrder));
      setCategoryIds(current.categoryIds);
      setFields(current.orderFieldSchema);
    }
  }

  const submit = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Nama wajib diisi";
    const slugValue = slug.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugValue)) errs.slug = "Slug harus kebab-case (huruf kecil, angka, tanda minus)";
    else if (existingSlugs.has(slugValue) && slugValue !== current?.slug) errs.slug = "Slug sudah dipakai game lain";
    if (current && existingIds.has(current.id) === false) errs.name = "Game asal tidak ditemukan";
    const keys = new Set<string>();
    for (const f of fields) {
      if (!f.key.trim()) errs.fields = "Ada field tanpa kunci (key)";
      if (keys.has(f.key)) errs.fields = `Kunci field duplikat: ${f.key}`;
      keys.add(f.key);
      if (!f.label.trim()) errs.fields = `Label untuk "${f.key}" kosong`;
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    onSave({
      id: current?.id ?? slugValue,
      slug: slugValue,
      name: name.trim(),
      description: description.trim() || undefined,
      ...(image ? { image } : {}),
      categoryIds,
      orderFieldSchema: fields,
      enabled,
      sortOrder: Number(sortOrder) || 1,
    });
  };

  const updateField = (index: number, patch: Partial<OrderField>) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="scroll-slim max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{isNew ? "Game baru" : `Ubah ${current?.name}`}</DialogTitle>
          <DialogDescription>
            Field pesanan menentukan data akun yang diminta dari pelanggan saat checkout.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-name">Nama</Label>
              <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={errors.name ? true : undefined} />
              {errors.name ? <p role="alert" className="text-xs text-destructive">{errors.name}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-slug">Slug</Label>
              <Input id="g-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="otomatis dari nama" className="font-mono text-xs" aria-invalid={errors.slug ? true : undefined} />
              {errors.slug ? <p role="alert" className="text-xs text-destructive">{errors.slug}</p> : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="g-desc">Deskripsi singkat</Label>
            <Textarea id="g-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Genre dan penerbit, cukup 1 kalimat." />
          </div>

          <div className="space-y-1.5">
            <Label>Icon game</Label>
            <div className="flex items-center gap-3">
              <GameMark name={name || "New"} image={image} size="lg" className="shadow-card" />
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent">
                  <ImagePlus aria-hidden="true" className="h-3.5 w-3.5" />
                  {image ? "Ganti icon" : "Unggah icon"}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    aria-label="Unggah icon game"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      try {
                        const dataUri = await fileToIconDataUri(file);
                        setImage(dataUri);
                        toast.success("Icon siap", {
                          description: "Jangan lupa simpan draft lalu sinkronkan.",
                        });
                      } catch (err) {
                        toast.error("Icon gagal diproses", {
                          description: (err as Error).message,
                        });
                      }
                    }}
                  />
                </label>
                {image ? (
                  <Button type="button" variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => setImage(undefined)}>
                    <X aria-hidden="true" className="h-3.5 w-3.5" />
                    Hapus icon
                  </Button>
                ) : null}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Gambar dipangkas persegi otomatis. Tanpa icon, game memakai monogram nama.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-order">Urutan tampil</Label>
              <Input id="g-order" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
            <div className="flex items-center justify-between self-end rounded-md border px-3 py-2.5">
              <Label htmlFor="g-enabled">Aktif</Label>
              <Switch id="g-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>

          {categories.length > 0 ? (
            <div className="space-y-1.5">
              <Label>Kategori</Label>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs">
                    <input
                      type="checkbox"
                      checked={categoryIds.includes(c.id)}
                      onChange={(e) =>
                        setCategoryIds((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id)))
                      }
                      className="accent-[var(--primary)]"
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Field pesanan</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setFields((prev) => [
                    ...prev,
                    { key: "", label: "", type: "text", required: true },
                  ])
                }
              >
                <Plus aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
                Field
              </Button>
            </div>
            {errors.fields ? <p role="alert" className="text-xs text-destructive">{errors.fields}</p> : null}
            {fields.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Tanpa field, pelanggan hanya mengisi nama dan catatan.
              </p>
            ) : (
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto_auto] items-end gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs" htmlFor={`f-key-${i}`}>Kunci</Label>
                      <Input id={`f-key-${i}`} value={f.key} onChange={(e) => updateField(i, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} className="h-8 font-mono text-xs" placeholder="playerId" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs" htmlFor={`f-label-${i}`}>Label</Label>
                      <Input id={`f-label-${i}`} value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} className="h-8" placeholder="User ID" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs" htmlFor={`f-type-${i}`}>Tipe</Label>
                      <select
                        id={`f-type-${i}`}
                        value={f.type}
                        onChange={(e) => updateField(i, { type: e.target.value as OrderField["type"] })}
                        className="h-8 rounded-md border bg-transparent px-2 text-xs"
                      >
                        <option value="text">teks</option>
                        <option value="number">angka</option>
                      </select>
                    </div>
                    <label className="flex h-8 items-center gap-1.5 pb-1 text-xs">
                      <input
                        type="checkbox"
                        checked={f.required}
                        onChange={(e) => updateField(i, { required: e.target.checked })}
                        className="accent-[var(--primary)]"
                      />
                      wajib
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Hapus field ${f.label || f.key}`}
                      onClick={() => setFields((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
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

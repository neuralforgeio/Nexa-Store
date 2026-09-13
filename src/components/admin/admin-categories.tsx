"use client";

import { useState } from "react";
import { useManagementCatalog } from "@/lib/queries";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { LoadingState, ErrorState, EmptyState } from "@/components/shared/state-views";
import { SyncBar } from "./sync-bar";
import type { Category } from "@/lib/catalog/types";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";

type DraftState = { categories: Category[] };

export function AdminCategories() {
  const { data, isPending, isError, refetch } = useManagementCatalog(true);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [editing, setEditing] = useState<Category | "new" | null>(null);

  const working = draft?.categories ?? data?.categories ?? [];

  if (isPending) return <LoadingState label="Memuat kategori…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Data kategori tidak dapat dimuat"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  const setCategories = (updater: (cats: Category[]) => Category[]) => {
    setDraft((prev) => ({ categories: updater(prev?.categories ?? data.categories) }));
  };

  return (
    <div className="pb-20">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Kategori</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pengelompokan opsional untuk storefront. Filter kategori tampil hanya bila ada kategori aktif.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
          Kategori baru
        </Button>
      </header>

      {working.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="Belum ada kategori"
          description="Kategori tidak wajib. Tambahkan bila ingin mengelompokkan game di storefront."
        />
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kategori</TableHead>
                <TableHead className="text-center">Aktif</TableHead>
                <TableHead className="w-16 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...working]
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((c) => (
                  <TableRow key={c.id} className={!c.enabled ? "opacity-55" : undefined}>
                    <TableCell>
                      <p className="font-medium">{c.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{c.slug}</p>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={c.enabled}
                        aria-label={`${c.enabled ? "Nonaktifkan" : "Aktifkan"} kategori ${c.name}`}
                        onCheckedChange={(checked) =>
                          setCategories((cats) => cats.map((x) => (x.id === c.id ? { ...x, enabled: checked } : x)))
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Ubah ${c.name}`} onClick={() => setEditing(c)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CategoryEditor
        editing={editing}
        existingSlugs={new Set(working.map((c) => c.slug))}
        onClose={() => setEditing(null)}
        onSave={(category) => {
          setCategories((cats) => {
            const index = cats.findIndex((c) => c.id === category.id);
            if (index === -1) return [...cats, category];
            const next = [...cats];
            next[index] = category;
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

function CategoryEditor({
  editing,
  existingSlugs,
  onClose,
  onSave,
}: {
  editing: Category | "new" | null;
  existingSlugs: Set<string>;
  onClose: () => void;
  onSave: (category: Category) => void;
}) {
  const isNew = editing === "new";
  const current = isNew ? null : editing;
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(true);
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
      setEnabled(true);
    } else if (current) {
      setName(current.name);
      setSlug(current.slug);
      setDescription(current.description ?? "");
      setEnabled(current.enabled);
    }
  }

  const submit = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Nama wajib diisi";
    const slugValue = slug.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugValue)) errs.slug = "Slug harus kebab-case";
    else if (existingSlugs.has(slugValue) && slugValue !== current?.slug) errs.slug = "Slug sudah dipakai";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    onSave({
      id: current?.id ?? slugValue,
      slug: slugValue,
      name: name.trim(),
      description: description.trim() || undefined,
      enabled,
      sortOrder: current?.sortOrder ?? 100,
    });
  };

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">{isNew ? "Kategori baru" : `Ubah ${current?.name}`}</DialogTitle>
          <DialogDescription>Perubahan masuk draft sampai disinkronkan.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Nama</Label>
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={errors.name ? true : undefined} />
            {errors.name ? <p role="alert" className="text-xs text-destructive">{errors.name}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-slug">Slug</Label>
            <Input id="c-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="otomatis dari nama" className="font-mono text-xs" aria-invalid={errors.slug ? true : undefined} />
            {errors.slug ? <p role="alert" className="text-xs text-destructive">{errors.slug}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-desc">Deskripsi (opsional)</Label>
            <Input id="c-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <Label htmlFor="c-enabled">Aktif</Label>
            <Switch id="c-enabled" checked={enabled} onCheckedChange={setEnabled} />
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

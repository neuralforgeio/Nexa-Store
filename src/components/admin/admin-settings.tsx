"use client";

import { useState } from "react";
import { useSettingsBundle, useSettingsMutation } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LoadingState, ErrorState } from "@/components/shared/state-views";
import { ApiError } from "@/lib/api-client";
import { toWaDigits } from "@/lib/format/phone";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

/** Store settings form (PRD §16.4) — no credentials, ever. */
export function AdminSettings() {
  const { data, isPending, isError, refetch } = useSettingsBundle(true);
  const mutation = useSettingsMutation();
  const [draft, setDraft] = useState<SettingsBundleDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (isPending) return <LoadingState label="Memuat pengaturan…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Pengaturan tidak dapat dimuat"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  const working = draft ?? {
    storeName: data.settings.storeName,
    whatsappNumber: data.settings.whatsappNumber,
    announcement: data.settings.announcement ?? "",
    maintenanceMode: data.settings.maintenanceMode,
    maintenanceMessage: data.settings.maintenanceMessage ?? "",
    supportNote: data.settings.supportNote ?? "",
  };
  const dirty = JSON.stringify(working) !== JSON.stringify({
    storeName: data.settings.storeName,
    whatsappNumber: data.settings.whatsappNumber,
    announcement: data.settings.announcement ?? "",
    maintenanceMode: data.settings.maintenanceMode,
    maintenanceMessage: data.settings.maintenanceMessage ?? "",
    supportNote: data.settings.supportNote ?? "",
  });

  const set = (patch: Partial<SettingsBundleDraft>) => setDraft({ ...working, ...patch });

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!working.storeName.trim()) errs.storeName = "Nama store wajib diisi";
    if (!toWaDigits(working.whatsappNumber)) errs.whatsappNumber = "Nomor WhatsApp tidak valid";
    if (working.maintenanceMode && !working.maintenanceMessage.trim())
      errs.maintenanceMessage = "Mode perbaikan butuh pesan yang ditampilkan";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    try {
      const result = await mutation.mutateAsync({
        baseRevision: data.revision,
        baseFileShas: data.fileShas,
        settings: {
          storeName: working.storeName.trim(),
          whatsappNumber: working.whatsappNumber.trim(),
          currency: "IDR",
          locale: "id-ID",
          announcement: working.announcement.trim() || undefined,
          maintenanceMode: working.maintenanceMode,
          maintenanceMessage: working.maintenanceMessage.trim() || undefined,
          supportNote: working.supportNote.trim() || undefined,
        },
        checkoutTemplate: data.checkoutTemplate,
      });
      setDraft(null);
      toast.success("Pengaturan tersimpan", {
        description: `${result.commitMessage} · revisi ${result.revision.slice(0, 12)}`,
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === "repo.conflict") {
        toast.error("Konflik data terdeteksi", {
          description: "Data berubah sejak halaman dibuka. Muat ulang lalu isi kembali.",
          duration: 10000,
        });
      } else if (e instanceof ApiError) {
        toast.error("Gagal menyimpan", { description: e.message });
      } else {
        toast.error("Gagal menyimpan", { description: "Pengaturan tidak berubah." });
      }
    }
  };

  return (
    <div className="pb-24">
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight">Pengaturan store</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Identitas store, nomor WhatsApp tujuan, pengumuman, dan mode perbaikan.
        </p>
      </header>

      <div className="mt-6 grid max-w-2xl gap-5">
        <div className="space-y-1.5">
          <Label htmlFor="s-name">Nama store</Label>
          <Input id="s-name" value={working.storeName} onChange={(e) => set({ storeName: e.target.value })} aria-invalid={errors.storeName ? true : undefined} />
          {errors.storeName ? <p role="alert" className="text-xs text-destructive">{errors.storeName}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="s-wa">Nomor WhatsApp tujuan</Label>
          <Input id="s-wa" value={working.whatsappNumber} onChange={(e) => set({ whatsappNumber: e.target.value })} placeholder="+62 …" aria-invalid={errors.whatsappNumber ? true : undefined} />
          {errors.whatsappNumber ? (
            <p role="alert" className="text-xs text-destructive">{errors.whatsappNumber}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Terformat ke wa.me/<span className="font-mono">{toWaDigits(working.whatsappNumber) ?? "?"}</span>
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="s-announce">Pengumuman (opsional)</Label>
          <Textarea id="s-announce" rows={2} value={working.announcement} onChange={(e) => set({ announcement: e.target.value })} placeholder="Tampil sebagai strip di atas storefront." />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="s-support">Catatan bantuan storefront (opsional)</Label>
          <Textarea id="s-support" rows={3} value={working.supportNote} onChange={(e) => set({ supportNote: e.target.value })} />
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="s-maint">Mode perbaikan</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Storefront menampilkan pesan perbaikan; tombol pesan dimatikan. Panel kelola tetap bisa diakses.
              </p>
            </div>
            <Switch
              id="s-maint"
              checked={working.maintenanceMode}
              onCheckedChange={(checked) => set({ maintenanceMode: checked })}
              aria-describedby="s-maint-desc"
            />
          </div>
          {working.maintenanceMode ? (
            <div className="mt-3 space-y-1.5">
              <Label htmlFor="s-maintmsg">Pesan mode perbaikan</Label>
              <Textarea
                id="s-maintmsg"
                rows={2}
                value={working.maintenanceMessage}
                onChange={(e) => set({ maintenanceMessage: e.target.value })}
                aria-invalid={errors.maintenanceMessage ? true : undefined}
              />
              {errors.maintenanceMessage ? (
                <p role="alert" className="text-xs text-destructive">{errors.maintenanceMessage}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 mt-8 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {mutation.isPending ? "Menyimpan…" : dirty ? "Ada perubahan belum disimpan" : "Tersimpan"}
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
              Simpan perubahan
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

type SettingsBundleDraft = {
  storeName: string;
  whatsappNumber: string;
  announcement: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  supportNote: string;
};

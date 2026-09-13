"use client";

import { useState } from "react";
import { useAccessControl, useSiteControlMutation } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LoadingState, ErrorState } from "@/components/shared/state-views";
import { formatWib } from "@/lib/format/date";
import { ApiError } from "@/lib/api-client";
import { LOCKABLE_ROUTES } from "@/lib/catalog/site-control";
import type { SiteGateState } from "@/lib/catalog/types";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Eye,
  Info,
  Power,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Developer-only site control: LOCKDOWN (total or route-scoped, red gate at
 * /lockdown) and MAINTENANCE (total or route-scoped, amber gate at
 * /maintenance). Server-enforced before the storefront renders; staff routes
 * (/login, /admin, /dev) are never gated so the Developer can always lift it.
 */
export function DevControl() {
  const { data, isPending, isError, refetch } = useAccessControl(true);
  const mutation = useSiteControlMutation();

  const [lockdownFormOpen, setLockdownFormOpen] = useState(false);
  const [maintenanceFormOpen, setMaintenanceFormOpen] = useState(false);
  const [lockdownOffConfirm, setLockdownOffConfirm] = useState(false);
  const [maintenanceOffConfirm, setMaintenanceOffConfirm] = useState(false);

  if (isPending) return <LoadingState label="Memuat status situs…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Status situs tidak dapat dimuat"
        action={
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Coba lagi
          </Button>
        }
      />
    );
  }

  const onError = (e: unknown) => {
    const message =
      e instanceof ApiError && e.status === 409
        ? "Status situs berubah sejak halaman ini dibuka. Muat ulang lalu coba lagi."
        : "Perubahan gagal disimpan. Coba lagi.";
    toast.error("Gagal menyimpan", { description: message });
  };

  const apply = (
    gateKind: "lockdown" | "maintenance",
    next: { active: boolean; scope: "all" | "routes"; routes: string[]; note?: string },
    successTitle: string,
    successDesc: string
  ) => {
    const gateState: SiteGateState = {
      active: next.active,
      scope: next.scope,
      routes: next.routes,
      note: next.note,
    };
    mutation.mutate(
      {
        baseRevision: data.revision,
        baseFileShas: data.fileShas,
        siteControl:
          gateKind === "lockdown" ? { lockdown: gateState } : { maintenance: gateState },
      },
      {
        onSuccess: () => {
          toast.success(successTitle, { description: successDesc });
          setLockdownFormOpen(false);
          setMaintenanceFormOpen(false);
          setLockdownOffConfirm(false);
          setMaintenanceOffConfirm(false);
        },
        onError,
      }
    );
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight">Kontrol Situs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lockdown dan mode pemeliharaan untuk seluruh situs atau route tertentu.
          Hanya Developer yang bisa mengubahnya.
        </p>
      </header>

      <GateSection
        kind="lockdown"
        gate={data.lockdown}
        onOpenForm={() => setLockdownFormOpen(true)}
        onDeactivate={() => setLockdownOffConfirm(true)}
      />
      <GateSection
        kind="maintenance"
        gate={data.maintenance}
        onOpenForm={() => setMaintenanceFormOpen(true)}
        onDeactivate={() => setMaintenanceOffConfirm(true)}
      />

      {/* Rules explainer */}
      <section aria-label="Aturan gate" className="rounded-xl border bg-card p-5 shadow-card">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
          <Info aria-hidden="true" className="h-4 w-4 text-primary" />
          Cara kerja gate
        </h2>
        <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
          {[
            "Pengunjung yang menabrak route terkunci diarahkan ke halaman /lockdown (merah) atau /maintenance (kuning) berisi alasan atau pesan.",
            "Route yang bisa dikunci: Beranda, Katalog game, halaman detail game, dan Bantuan.",
            "Halaman staf (/login, /admin, /dev) tidak pernah ikut terkunci — agar gate selalu bisa dimatikan.",
            "Developer selalu lolos dari semua gate. Admin lolos dari maintenance, tetapi tetap terkena lockdown.",
            "Jika lockdown dan maintenance aktif bersamaan pada route yang sama, lockdown yang ditampilkan.",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* Activation / edit forms */}
      <GateFormDialog
        kind="lockdown"
        gate={data.lockdown}
        open={lockdownFormOpen}
        onOpenChange={setLockdownFormOpen}
        pending={mutation.isPending}
        onSubmit={(next) =>
          apply(
            "lockdown",
            next,
            next.scope === "all" ? "Lockdown total diaktifkan" : "Lockdown route diaktifkan",
            next.scope === "all"
              ? "Seluruh situs publik sekarang mengarah ke /lockdown."
              : "Route terpilih sekarang mengarah ke /lockdown."
          )
        }
      />
      <GateFormDialog
        kind="maintenance"
        gate={data.maintenance}
        open={maintenanceFormOpen}
        onOpenChange={setMaintenanceFormOpen}
        pending={mutation.isPending}
        onSubmit={(next) =>
          apply(
            "maintenance",
            next,
            next.scope === "all" ? "Maintenance total diaktifkan" : "Maintenance route diaktifkan",
            next.scope === "all"
              ? "Seluruh situs publik sekarang mengarah ke /maintenance."
              : "Route terpilih sekarang mengarah ke /maintenance."
          )
        }
      />

      {/* Deactivation confirms */}
      <AlertDialog open={lockdownOffConfirm} onOpenChange={setLockdownOffConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nonaktifkan lockdown?</AlertDialogTitle>
            <AlertDialogDescription>
              Situs publik akan langsung terbuka kembali untuk semua pengunjung.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                apply("lockdown", { active: false, scope: data.lockdown.scope, routes: data.lockdown.routes }, "Lockdown dinonaktifkan", "Situs publik kembali terbuka. Periksa halaman depan bila perlu.");
              }}
            >
              Ya, nonaktifkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={maintenanceOffConfirm} onOpenChange={setMaintenanceOffConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Akhiri mode pemeliharaan?</AlertDialogTitle>
            <AlertDialogDescription>
              Route yang terkena maintenance akan langsung kembali normal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                apply("maintenance", { active: false, scope: data.maintenance.scope, routes: data.maintenance.routes }, "Maintenance diakhiri", "Situs publik kembali normal. Periksa halaman depan bila perlu.");
              }}
            >
              Ya, akhiri
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function GateSection({
  kind,
  gate,
  onOpenForm,
  onDeactivate,
}: {
  kind: "lockdown" | "maintenance";
  gate: SiteGateState;
  onOpenForm: () => void;
  onDeactivate: () => void;
}) {
  const isLockdown = kind === "lockdown";
  const active = gate.active;
  const Icon = isLockdown ? ShieldAlert : Wrench;
  const tone = isLockdown
    ? {
        border: active ? "border-destructive/40" : "border-border",
        bg: active ? "bg-destructive/5" : "bg-card",
        iconWrap: active
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-border bg-surface-2 text-muted-foreground",
        badge: active
          ? "bg-destructive/15 text-destructive"
          : "bg-surface-2 text-muted-foreground",
      }
    : {
        border: active ? "border-primary/45" : "border-border",
        bg: active ? "bg-primary/5" : "bg-card",
        iconWrap: active
          ? "border-primary/35 bg-primary/10 text-primary"
          : "border-border bg-surface-2 text-muted-foreground",
        badge: active
          ? "bg-primary/15 text-primary"
          : "bg-surface-2 text-muted-foreground",
      };

  const affectedRoutes =
    gate.scope === "all"
      ? "Seluruh situs publik"
      : LOCKABLE_ROUTES.filter((r) => gate.routes.includes(r.id))
          .map((r) => r.label)
          .join(", ") || "—";

  return (
    <section
      aria-label={isLockdown ? "Status lockdown" : "Status maintenance"}
      className={`rounded-xl border p-5 shadow-card ${tone.border} ${tone.bg}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${tone.iconWrap}`}>
            <Icon aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <p className="flex flex-wrap items-center gap-2.5 font-display text-base font-semibold">
              {isLockdown ? "Lockdown situs" : "Mode pemeliharaan"}
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest ${tone.badge}`}
              >
                {active ? (isLockdown ? "Lockdown aktif" : "Aktif") : "Nonaktif"}
              </span>
            </p>
            <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
              {isLockdown
                ? active
                  ? "Pengunjung diarahkan ke /lockdown dengan alasan yang tertera."
                  : "Menutup seluruh atau sebagian situs publik dan mengarahkannya ke /lockdown."
                : active
                  ? "Pengunjung diarahkan ke /maintenance dengan pesan yang tertera."
                  : "Menampilkan halaman pemeliharaan kuning pada seluruh atau sebagian situs."}
            </p>

            {active ? (
              <div className="mt-3 space-y-2 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Cakupan
                  </span>
                  <span className="rounded-md border border-border bg-surface-2/70 px-2 py-0.5 text-xs">
                    {affectedRoutes}
                  </span>
                </p>
                {gate.note ? (
                  <p className="rounded-lg border border-border/70 bg-surface-2/50 px-3 py-2 text-sm text-foreground/85">
                    “{gate.note}”
                  </p>
                ) : null}
                {gate.updatedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Diaktifkan {formatWib(new Date(gate.updatedAt))}
                    {gate.updatedBy ? ` oleh ${gate.updatedBy}` : ""}.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={active ? "outline" : isLockdown ? "destructive" : "default"}
            className="gap-2"
            onClick={onOpenForm}
          >
            <Power aria-hidden="true" className="h-4 w-4" />
            {active ? "Ubah" : isLockdown ? "Aktifkan lockdown" : "Aktifkan maintenance"}
          </Button>
          {active ? (
            <Button variant="outline" className="gap-2" onClick={onDeactivate}>
              <Ban aria-hidden="true" className="h-4 w-4" />
              {isLockdown ? "Nonaktifkan" : "Akhiri"}
            </Button>
          ) : null}
        </div>
      </div>

      {active ? (
        <div className="mt-4 border-t border-border/60 pt-3">
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              Gate ini <strong className="font-semibold text-foreground">aktif dan sedang ditegakkan</strong> untuk
              pengunjung biasa. Kamu tidak diarahkan ke halaman gate karena sesi Developer selalu
              lolos — pakai tombol {isLockdown ? "Nonaktifkan" : "Akhiri"} untuk membuka situs.
            </span>
          </p>
          <a
            href={isLockdown ? "/lockdown" : "/maintenance"}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2/60 px-3 py-1.5 text-xs font-semibold text-foreground/85 transition-colors hover:bg-surface-2"
          >
            <Eye aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
            Lihat tampilan halaman {isLockdown ? "lockdown" : "maintenance"}
          </a>
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function GateFormDialog({
  kind,
  gate,
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  kind: "lockdown" | "maintenance";
  gate: SiteGateState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSubmit: (next: { active: boolean; scope: "all" | "routes"; routes: string[]; note?: string }) => void;
}) {
  const isLockdown = kind === "lockdown";
  const [scope, setScope] = useState<"all" | "routes">(gate.scope);
  const [routes, setRoutes] = useState<string[]>(gate.routes);
  const [note, setNote] = useState(gate.note ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (scope === "routes" && routes.length === 0) {
      setError("Pilih minimal satu route yang mau dikunci.");
      return;
    }
    if (isLockdown && note.trim().length < 4) {
      setError("Lockdown wajib menyertakan alasan (min. 4 karakter) — ditampilkan di halaman /lockdown.");
      return;
    }
    setError(null);
    onSubmit({
      active: true,
      scope,
      routes: scope === "routes" ? routes : [],
      note: note.trim() || undefined,
    });
  };

  const toggleRoute = (id: string, checked: boolean) => {
    setRoutes((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((r) => r !== id)));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isLockdown ? <ShieldAlert aria-hidden="true" className="h-5 w-5 text-destructive" /> : null}
            {!isLockdown ? <Wrench aria-hidden="true" className="h-5 w-5 text-primary" /> : null}
            {isLockdown ? "Aktifkan lockdown" : "Aktifkan mode pemeliharaan"}
          </DialogTitle>
          <DialogDescription>
            {isLockdown
              ? "Pengunjung route terpilih akan diarahkan ke halaman /lockdown."
              : "Pengunjung route terpilih akan diarahkan ke halaman /maintenance (kuning)."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2.5">
            <Label>Cakupan</Label>
            <RadioGroup
              value={scope}
              onValueChange={(v) => setScope(v as "all" | "routes")}
              className="gap-2"
            >
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-surface-1 [&:has([data-state=checked])]:border-primary/50">
                <RadioGroupItem value="all" className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">Seluruh situs (total)</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Beranda, katalog, detail game, dan bantuan sekaligus.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-surface-1 [&:has([data-state=checked])]:border-primary/50">
                <RadioGroupItem value="routes" className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">Route tertentu</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Pilih route publik yang ingin dikunci di bawah.
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>

          {scope === "routes" ? (
            <div className="space-y-2">
              <Label>Route yang dikunci</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {LOCKABLE_ROUTES.map((route) => (
                  <label
                    key={route.id}
                    className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors hover:bg-surface-1"
                  >
                    <Checkbox
                      checked={routes.includes(route.id)}
                      onCheckedChange={(checked) => toggleRoute(route.id, checked === true)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-sm font-medium">{route.label}</span>
                      <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                        {route.id}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor={`gate-note-${kind}`}>
              {isLockdown ? "Alasan (wajib)" : "Pesan (opsional)"}
            </Label>
            <Textarea
              id={`gate-note-${kind}`}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                isLockdown
                  ? "Ditampilkan besar di halaman /lockdown, contoh: ada indikasi penyalahgunaan, sedang diaudit."
                  : "Ditampilkan di halaman /maintenance, contoh: upgrade server, selesai sekitar 30 menit."
              }
            />
            <p className="text-[11px] text-muted-foreground/70">
              {isLockdown
                ? "Maksimal 300 karakter. Pengunjung akan melihat teks ini persis apa adanya."
                : "Kosongkan untuk memakai pesan pemeliharaan bawaan."}
            </p>
          </div>

          {error ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Batal
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending}
            className={isLockdown ? "gap-2 bg-destructive text-white hover:bg-destructive/90" : "gap-2"}
          >
            {isLockdown ? <ShieldAlert aria-hidden="true" className="h-4 w-4" /> : <Wrench aria-hidden="true" className="h-4 w-4" />}
            Aktifkan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

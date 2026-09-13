"use client";

import { useState } from "react";
import { useAccessControl, useAccessControlMutation } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { CheckCircle2, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";

/**
 * Developer-only Admin access control (D8).
 * Blocking prevents the Admin from logging in AND revokes active sessions.
 */
export function DevAccess() {
  const { data, isPending, isError, refetch } = useAccessControl(true);
  const mutation = useAccessControlMutation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (isPending) return <LoadingState label="Memuat status akses…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Status akses tidak dapat dimuat"
        action={
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Coba lagi
          </Button>
        }
      />
    );
  }

  const blocked = data.adminBlocked;

  const apply = (adminBlocked: boolean) => {
    mutation.mutate(
      {
        baseRevision: data.revision,
        baseFileShas: data.fileShas,
        adminBlocked,
        ...(adminBlocked && reason.trim() ? { reason: reason.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success(
            adminBlocked ? "Akses admin diblokir." : "Akses admin dibuka kembali.",
            {
              description: adminBlocked
                ? "Admin tidak bisa login sampai dibuka kembali."
                : "Admin bisa login kembali sekarang.",
            }
          );
          setConfirmOpen(false);
          setReason("");
        },
        onError: (e) => {
          const message =
            e instanceof ApiError && e.status === 409
              ? "Status akses berubah sejak halaman ini dibuka. Muat ulang lalu coba lagi."
              : "Perubahan gagal disimpan. Coba lagi.";
          toast.error("Gagal menyimpan", { description: message });
        },
      }
    );
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight">Akses</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kontrol akses Admin ke dashboard. Hanya Developer yang bisa mengubahnya.
        </p>
      </header>

      {/* Status card */}
      <section
        aria-label="Status akses admin"
        className={`rounded-xl border p-5 shadow-card ${
          blocked ? "border-destructive/40 bg-destructive/5" : "border-primary/25 bg-primary/5"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                blocked
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-primary/30 bg-primary/10 text-primary"
              }`}
            >
              {blocked ? <ShieldOff aria-hidden="true" className="h-5 w-5" /> : <ShieldCheck aria-hidden="true" className="h-5 w-5" />}
            </span>
            <div>
              <p className="font-display text-base font-semibold">
                {blocked ? "Admin diblokir" : "Admin aktif"}
              </p>
              <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
                {blocked
                  ? "Login Admin ditolak dan sesi yang sedang berjalan dicabut sampai dibuka kembali."
                  : "Admin bisa login dan mengelola katalog seperti biasa."}
              </p>
              {blocked && data.reason ? (
                <p className="mt-2 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                  Alasan: {data.reason}
                </p>
              ) : null}
            </div>
          </div>

          {blocked ? (
            <Button
              variant="outline"
              className="gap-2"
              disabled={mutation.isPending}
              onClick={() => apply(false)}
            >
              <ShieldCheck aria-hidden="true" className="h-4 w-4" />
              Buka akses
            </Button>
          ) : (
            <Button
              variant="destructive"
              className="gap-2"
              disabled={mutation.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              <ShieldAlert aria-hidden="true" className="h-4 w-4" />
              Blokir admin
            </Button>
          )}
        </div>

        {data.updatedAt ? (
          <p className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
            Terakhir diubah {formatWib(new Date(data.updatedAt))}
            {data.updatedBy ? ` oleh ${data.updatedBy}` : ""}.
          </p>
        ) : (
          <p className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
            Belum pernah diubah sejak data awal.
          </p>
        )}
      </section>

      {/* Impact explanation */}
      <section aria-label="Efek pemblokiran" className="rounded-xl border bg-card p-5 shadow-card">
        <h2 className="font-display text-sm font-semibold">Apa yang terjadi saat admin diblokir</h2>
        <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
          {[
            "Login Admin ditolak dengan pesan akses diblokir.",
            "Sesi Admin yang sedang aktif langsung kehilangan akses ke semua API panel.",
            "Perubahan ini tersimpan di data/store/access-control.json dan ikut tersinkron ke repository saat mode GitHub aktif.",
            "Developer tetap bisa login dan membuka kembali akses Admin kapan saja.",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* Block confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Blokir akses Admin?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                Admin tidak akan bisa login sampai dibuka kembali. Sesi yang sedang
                berjalan juga dicabut. Aksi ini bisa dibatalkan kapan saja dari
                halaman ini.
                <div className="mt-4 space-y-1.5">
                  <Label htmlFor="block-reason">Alasan (opsional)</Label>
                  <Textarea
                    id="block-reason"
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Catatan internal, contohnya: pelanggaran prosedur harga"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={mutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                apply(true);
              }}
            >
              Ya, blokir admin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { RouteLink } from "@/components/shared/route-link";
import { Reveal } from "@/components/shared/reveal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { track } from "@/lib/analytics/tracker";
import { ArrowLeft, Bug, CheckCircle2, Flag, Lightbulb, Paperclip, Send, X } from "lucide-react";

/**
 * Laporan pengguna (v1.6.0, media persist v1.8.0) — /reports.
 * Bug, saran fitur, atau lainnya. Lampiran gambar/video opsional untuk
 * menunjukkan bug. Laporan + lampiran tersimpan permanen DAN diteruskan
 * ke Telegram pemilik store.
 */

const TYPES = [
  { value: "bug", label: "Bug", desc: "Ada yang tidak berfungkan", Icon: Bug },
  { value: "feature", label: "Saran Fitur", desc: "Ide untuk store", Icon: Lightbulb },
  { value: "other", label: "Lainnya", desc: "Pesan lain untuk admin", Icon: Flag },
] as const;

const MAX_IMAGE_MB = 2.5;
const MAX_VIDEO_MB = 4;

export function ReportsView() {
  const reducedMotion = useReducedMotion();
  const [type, setType] = useState<"bug" | "feature" | "other">("bug");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Preview kecil untuk gambar yang dipilih (object URL dibersihkan rapi).
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setFilePreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pickFile(f: File | null) {
    if (!f) return;
    const isImage = f.type.startsWith("image/");
    const isVideo = f.type.startsWith("video/");
    if (!isImage && !isVideo) {
      toast.error("Lampiran harus gambar atau video.");
      return;
    }
    const limitMb = isImage ? MAX_IMAGE_MB : MAX_VIDEO_MB;
    if (f.size > limitMb * 1024 * 1024) {
      toast.error(`Ukuran ${isImage ? "gambar" : "video"} maksimal ${limitMb} MB.`);
      return;
    }
    setFile(f);
  }

  async function submit() {
    if (text.trim().length < 10) {
      toast.error("Ceritakan lebih detail", { description: "Deskripsi minimal 10 karakter." });
      return;
    }
    setSending(true);
    try {
      const form = new FormData();
      form.set("type", type);
      if (name.trim()) form.set("name", name.trim());
      form.set("text", text.trim());
      if (file) form.set("media", file);

      const res = await fetch("/api/reports", { method: "POST", body: form });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message ?? "Laporan gagal terkirim.");
      }
      track("report_submit");
      setDone(true);
    } catch (e) {
      toast.error("Laporan gagal terkirim", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  }

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
      >
        <RouteLink
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          Beranda
        </RouteLink>

        <div className="mt-5 flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
            <Flag aria-hidden="true" className="h-6 w-6" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Laporan</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Menemukan bug, punya ide fitur, atau pesan lain untuk store? Kirim di sini —
              laporanmu langsung sampai ke admin beserta lampiran.
            </p>
          </div>
        </div>
      </motion.div>

      <Reveal delay={0.08} className="mt-8">
        {done ? (
          <section
            aria-live="polite"
            className="rounded-2xl border bg-card p-8 text-center shadow-card"
          >
            <CheckCircle2 aria-hidden="true" className="mx-auto h-12 w-12 text-emerald-600" />
            <h2 className="mt-4 font-display text-lg font-semibold">Laporan terkirim!</h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
              Terima kasih. Laporanmu sudah diteruskan ke admin. Bila kamu meninggalkan email
              atau kontak di deskripsi, admin bisa membalas lewat sana.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2.5">
              <Button
                variant="outline"
                onClick={() => {
                  setDone(false);
                  setText("");
                  setFile(null);
                  setName("");
                }}
              >
                Kirim laporan lain
              </Button>
              <Button asChild>
                <RouteLink href="/games">Kembali belanja</RouteLink>
              </Button>
            </div>
          </section>
        ) : (
          <section aria-labelledby="report-form" className="rounded-2xl border bg-card p-6 shadow-card sm:p-8">
            <h2 id="report-form" className="font-display text-lg font-semibold">
              Tulis laporan
            </h2>

            <div className="mt-6 space-y-6">
              <div className="space-y-2.5">
                <Label>Jenis laporan</Label>
                <RadioGroup
                  value={type}
                  onValueChange={(v) => setType(v as typeof type)}
                  className="grid gap-2.5 sm:grid-cols-3"
                >
                  {TYPES.map((t) => (
                    <Label
                      key={t.value}
                      htmlFor={`report-type-${t.value}`}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5"
                    >
                      <RadioGroupItem id={`report-type-${t.value}`} value={t.value} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-display text-sm font-semibold">
                          <t.Icon aria-hidden="true" className="h-4 w-4 text-primary" />
                          {t.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{t.desc}</span>
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label htmlFor="report-name">Nama kamu (opsional)</Label>
                <Input
                  id="report-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  placeholder="Agar admin tahu siapa yang mengirim"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="report-text">Deskripsi</Label>
                <Textarea
                  id="report-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={6}
                  maxLength={1500}
                  placeholder={
                    type === "bug"
                      ? "Ceritakan bug-nya: apa yang kamu lakukan, apa yang terjadi, dan apa yang seharusnya terjadi…"
                      : type === "feature"
                        ? "Fitur apa yang kamu inginkan? Kenapa itu membantu?"
                        : "Tulis pesanmu untuk admin…"
                  }
                />
                <p className="text-right text-xs text-muted-foreground">{text.length}/1500</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="report-media">Lampiran (opsional)</Label>
                <input
                  ref={fileRef}
                  id="report-media"
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
                    {filePreview ? (
                      /* object URL preview lokal, bukan aset Next */
                      <img
                        src={filePreview}
                        alt="Preview lampiran"
                        className="h-11 w-11 shrink-0 rounded-lg border object-cover"
                      />
                    ) : (
                      <Paperclip aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Hapus lampiran"
                      className="h-8 w-8 shrink-0 p-0"
                      onClick={() => {
                        setFile(null);
                        if (fileRef.current) fileRef.current.value = "";
                      }}
                    >
                      <X aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    <Paperclip aria-hidden="true" className="h-5 w-5" />
                    <span>
                      Sertakan tangkapan layar atau rekaman singkat — gamb. maks {MAX_IMAGE_MB} MB,
                      video maks {MAX_VIDEO_MB} MB
                    </span>
                  </button>
                )}
              </div>

              <Button
                onClick={submit}
                disabled={sending || text.trim().length < 10}
                className="w-full gap-2 font-semibold sm:w-auto"
              >
                <Send aria-hidden="true" className="h-4 w-4" />
                {sending ? "Mengirim…" : "Kirim laporan"}
              </Button>
            </div>
          </section>
        )}
      </Reveal>
    </main>
  );
}

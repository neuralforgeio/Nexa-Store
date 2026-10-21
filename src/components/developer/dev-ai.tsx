"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
import {
  useAiBot,
  useAiDatasetMutation,
  useAiImportMutation,
  useAiTrainMutation,
  useAiResetMutation,
  type AiDatasetIntent,
  type AiTrainResult,
} from "@/lib/queries";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  BrainCircuit,
  Gamepad2,
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  Upload,
  Play,
  RotateCcw,
  FileJson,
  Zap,
  MessageSquareText,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

/**
 * Panel AI Bot (v1.17.0) — pusat kendali otak Nexa Bot.
 *
 * 1. Status otak aktif (model bawaan repo vs model hasil latih ulang)
 * 2. Dataset kustom — CRUD intent; langsung hidup via overlay TF-IDF
 * 3. Impor data massal — tempel JSON / unggah file (format lengkap {intent,
 *    utterances, answer} atau sederhana {q, a}); placeholder {name} didukung
 * 4. Latih ulang — training NLP penuh (builtin + katalog live + kustom),
 *    model tersimpan ke data store dan langsung dipakai tanpa redeploy
 * 5. Konsol uji — coba pertanyaan dan lihat intent/skor/jawaban
 * 6. Reset — buang model kustom / kembalikan ke otak bawaan
 */

const EXAMPLE_IMPORT = JSON.stringify(
  [
    {
      intent: "faq.ongkir",
      utterances: ["apakah ada ongkir", "biaya kirim berapa", "perlu bayar ongkos kirim gak"],
      answer: "Tidak ada ongkir sama sekali! 🚀 Semua produk digital, langsung dikirim ke akun game-mu setelah pembayaran.",
    },
    { q: "gimana gabung reseller", a: "Untuk kemitraan/reseller, chat admin lewat WhatsApp ya 🤝 Ada menu Bantuan di situs." },
  ],
  null,
  2
);

type TestReply = { text: string; intent: string; score: number; answer: string };

export function DevAi() {
  const { data, isPending, isError, refetch } = useAiBot(true);
  const datasetMut = useAiDatasetMutation();
  const importMut = useAiImportMutation();
  const trainMut = useAiTrainMutation();
  const resetMut = useAiResetMutation();

  // --- editor intent ---
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AiDatasetIntent | null>(null);
  const [form, setForm] = useState({ intent: "", utterances: "", answer: "" });

  // --- impor ---
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const fileRef = useRef<HTMLInputElement>(null);

  // --- konsol uji ---
  const [testText, setTestText] = useState("");
  const [testUser, setTestUser] = useState("Dearly");
  const [testBusy, setTestBusy] = useState(false);
  const [testLog, setTestLog] = useState<TestReply[]>([]);

  // --- dialog konfirmasi ---
  const [confirmTrain, setConfirmTrain] = useState(false);
  const [confirmResetModel, setConfirmResetModel] = useState(false);
  const [confirmResetAll, setConfirmResetAll] = useState(false);

  if (isPending) return <LoadingState label="Memuat status otak bot…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Panel AI tidak dapat dimuat"
        action={
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Coba lagi
          </Button>
        }
      />
    );
  }

  const openEditor = (item: AiDatasetIntent | null) => {
    setEditTarget(item);
    setForm({
      intent: item?.intent ?? "",
      utterances: (item?.utterances ?? []).join("\n"),
      answer: item?.answer ?? "",
    });
    setEditorOpen(true);
  };

  const saveIntent = async () => {
    const intent = form.intent.trim().toLowerCase();
    const utterances = form.utterances
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u.length >= 2);
    const answer = form.answer.trim();
    if (!intent || utterances.length === 0 || !answer) {
      toast.error("Lengkapi dulu", { description: "Nama intent, minimal 1 contoh kalimat, dan jawaban wajib ada." });
      return;
    }
    try {
      await datasetMut.mutateAsync({ action: "upsert", intent, utterances, answer });
      toast.success(editTarget ? "Intent diperbarui" : "Intent ditambahkan", {
        description: `Dataset langsung hidup — coba di Konsol Uji. Untuk pemahaman fuzzy penuh, jalankan Latih Ulang.`,
      });
      setEditorOpen(false);
    } catch (e) {
      toast.error("Gagal menyimpan", { description: e instanceof Error ? e.message : undefined });
    }
  };

  const deleteIntent = async (intent: string) => {
    try {
      await datasetMut.mutateAsync({ action: "delete", intent });
      toast.success(`Intent "${intent}" dihapus`);
    } catch (e) {
      toast.error("Gagal menghapus", { description: e instanceof Error ? e.message : undefined });
    }
  };

  const parseImportText = (): Array<Record<string, unknown>> | null => {
    try {
      const parsed = JSON.parse(importText);
      if (!Array.isArray(parsed)) {
        toast.error("Format salah", { description: "Akar JSON harus berupa array [...]." });
        return null;
      }
      return parsed as Array<Record<string, unknown>>;
    } catch {
      toast.error("JSON tidak valid", { description: "Periksa kembali tanda kutip dan koma." });
      return null;
    }
  };

  const doImport = async () => {
    const items = parseImportText();
    if (!items) return;
    try {
      const res = await importMut.mutateAsync({ items, mode: importMode });
      toast.success(`${res.imported} intent terimpor`, {
        description: [
          `Total dataset: ${res.datasetSize} intent.`,
          res.rejected > 0 ? `${res.rejected} ditolak — ${res.errors[0] ?? ""}` : "Semua item valid.",
          "Dataset langsung hidup via overlay TF-IDF.",
        ].join(" "),
      });
      setImportText("");
    } catch (e) {
      toast.error("Impor gagal", { description: e instanceof Error ? e.message : undefined });
    }
  };

  const onFile = (file: File | null) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      toast.error("File terlalu besar", { description: "Maksimal 2 MB untuk file dataset." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImportText(String(reader.result ?? ""));
      toast.info("File dimuat", { description: `${file.name} — periksa pratinjau lalu klik Impor.` });
    };
    reader.readAsText(file);
  };

  const runTrain = async () => {
    setConfirmTrain(false);
    try {
      const res: AiTrainResult = await trainMut.mutateAsync();
      if (res.modelSaved) {
        toast.success("Training selesai ⚡", {
          description: `${res.stats.intents} intent • ${res.stats.utterances.toLocaleString("id-ID")} utterance • model ${res.modelSizeMb} MB • ${res.timing.trainMs.toLocaleString("id-ID")} ms. Otak baru langsung aktif.`,
        });
      } else {
        toast.warning("Model terlatih tapi gagal disimpan", {
          description: `${res.saveError ?? ""} — dataset tetap hidup via overlay. Coba Latih Ulang lagi nanti.`,
        });
      }
    } catch (e) {
      toast.error("Training gagal", { description: e instanceof Error ? e.message : undefined });
    }
  };

  const runTest = async () => {
    const text = testText.trim();
    if (!text) return;
    setTestBusy(true);
    try {
      const reply = await api.post<TestReply>("/api/developer/ai/test", {
        text,
        userName: testUser.trim() || undefined,
      });
      setTestLog((prev) => [{ ...reply, text }, ...prev].slice(0, 8));
      setTestText("");
    } catch (e) {
      toast.error("Engine gagal menjawab", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setTestBusy(false);
    }
  };

  const doReset = async (keepDataset: boolean) => {
    if (keepDataset) setConfirmResetModel(false);
    else setConfirmResetAll(false);
    try {
      await resetMut.mutateAsync({ keepDataset });
      toast.success(keepDataset ? "Model kustom dibuang" : "Otak direset ke bawaan", {
        description: keepDataset
          ? "Dataset kustom dipertahankan (overlay tetap hidup). Model bawaan repo kini dipakai."
          : "Semua dataset kustom dan model hasil training dihapus.",
      });
    } catch (e) {
      toast.error("Reset gagal", { description: e instanceof Error ? e.message : undefined });
    }
  };

  const brain = data.brain;
  const activeCustom = brain.active === "custom";
  const dataset = data.dataset;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
          <BrainCircuit aria-hidden="true" className="h-5 w-5 text-amber-500" />
          AI Bot — Nexa Bot
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Latih ulang otak bot, impor dataset tanya-jawab, dan uji langsung — semua tanpa redeploy.
        </p>
      </header>

      {/* ===== Status otak ===== */}
      <section aria-label="Status otak" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Otak aktif</p>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant={activeCustom ? "default" : "secondary"} className={activeCustom ? "bg-amber-600 hover:bg-amber-600" : ""}>
              {activeCustom ? "Model Kustom" : "Bawaan Repo"}
            </Badge>
            {brain.custom?.hasModel && <span className="text-xs text-muted-foreground">v{brain.custom.version ?? "?"}</span>}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {activeCustom && brain.custom?.trainedAt
              ? `Dilatih ${new Date(brain.custom.trainedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}`
              : `Bawaan: v${brain.bundled.version} (${brain.bundled.trainedAtLabel})`}
          </p>
          {brain.custom && (
            <p className="mt-1 text-xs text-muted-foreground">
              {brain.custom.intentsCount ?? "–"} intent • {brain.custom.utterancesCount?.toLocaleString("id-ID") ?? "–"} utterance
            </p>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Otak cerdas LLM</p>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant={brain.llm?.available ? "default" : "secondary"} className={brain.llm?.available ? "bg-emerald-600 hover:bg-emerald-600" : ""}>
              {brain.llm?.available ? "Aktif" : "Nonaktif"}
            </Badge>
            {brain.llm?.available && (
              <span className="text-xs text-muted-foreground">
                {brain.llm.source === "env" ? "env produksi" : "config lokal"}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {brain.llm?.available
              ? "Memahami maksud & menalar data live — pertanyaan terbuka, budget, perbandingan."
              : "Tidak tersedia — bot memakai NLP lokal (cadangan) untuk semua pertanyaan."}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Katalog live</p>
          <p className="mt-2 font-display text-2xl font-semibold tabular-nums">
            {data.catalog?.games ?? "–"}
            <span className="ml-1 text-sm font-normal text-muted-foreground">game</span>
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {data.catalog?.products ?? "–"} pilihan nominal
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dataset kustom</p>
          <p className="mt-2 font-display text-2xl font-semibold tabular-nums">
            {dataset.length}
            <span className="ml-1 text-sm font-normal text-muted-foreground">intent</span>
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {dataset.reduce((n, d) => n + d.utterances.length, 0)} contoh kalimat
          </p>
        </Card>
      </section>

      {/* ===== Latih ulang ===== */}
      <Card className="p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xl">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Zap aria-hidden="true" className="h-4 w-4 text-amber-500" />
              Latih Ulang AI
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Melatih model NLP penuh dari corpus bawaan + katalog live + dataset kustom (± 10-30 detik).
              Model tersimpan ke data store dan otomatis dipakai situs, bot Telegram, dan API chat — tanpa redeploy.
            </p>
          </div>
          <Button
            onClick={() => setConfirmTrain(true)}
            disabled={trainMut.isPending}
            className="shrink-0 bg-amber-600 text-white hover:bg-amber-500"
          >
            {trainMut.isPending ? (
              <>
                <Sparkles aria-hidden="true" className="h-4 w-4 animate-pulse" />
                Melatih…
              </>
            ) : (
              <>
                <Sparkles aria-hidden="true" className="h-4 w-4" />
                Latih Ulang
              </>
            )}
          </Button>
        </div>
        {trainMut.data && (
          <div className="mt-4 rounded-lg border bg-muted/40 p-3 text-xs">
            <p className="flex items-center gap-1.5 font-medium">
              {trainMut.data.modelSaved ? (
                <>
                  <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-600" />
                  Training terakhir sukses — {trainMut.data.stats.intents} intent /{" "}
                  {trainMut.data.stats.utterances.toLocaleString("id-ID")} utterance ({trainMut.data.modelSizeMb} MB,{" "}
                  {trainMut.data.timing.trainMs.toLocaleString("id-ID")} ms)
                </>
              ) : (
                <>
                  <AlertTriangle aria-hidden="true" className="h-4 w-4 text-amber-600" />
                  Model gagal disimpan ({trainMut.data.saveError}) — dataset tetap hidup via overlay
                </>
              )}
            </p>
          </div>
        )}
      </Card>

      {/* ===== Dataset kustom ===== */}
      <Card className="p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <FileJson aria-hidden="true" className="h-4 w-4 text-amber-500" />
              Dataset Kustom
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Langsung hidup lewat overlay TF-IDF sebelum training. Jawaban boleh memakai <code className="rounded bg-muted px-1">{"{name}"}</code> untuk nama pengguna.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => openEditor(null)} className="shrink-0">
            <Plus aria-hidden="true" className="h-4 w-4" />
            Tambah Intent
          </Button>
        </div>
        <Separator className="my-4" />
        {dataset.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Belum ada intent kustom. Tambahkan satu per satu di atas, atau impor massal di bawah. 👇
          </p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border" aria-label="Daftar intent kustom">
            {dataset.map((d) => (
              <li key={d.intent} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-medium">{d.intent}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {d.utterances.length} kalimat
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{d.answer}</p>
                  <p className="mt-1 line-clamp-1 font-mono text-[10px] text-muted-foreground/70">
                    mis. “{d.utterances[0]}”
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Ubah ${d.intent}`} onClick={() => openEditor(d)}>
                    <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    aria-label={`Hapus ${d.intent}`}
                    onClick={() => void deleteIntent(d.intent)}
                    disabled={datasetMut.isPending}
                  >
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ===== Impor data ===== */}
      <Card className="p-4 sm:p-6">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Upload aria-hidden="true" className="h-4 w-4 text-amber-500" />
          Impor Data
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Tempel JSON atau unggah file. Dua format diterima — lengkap{" "}
          <code className="rounded bg-muted px-1">{`{intent, utterances[], answer}`}</code> dan sederhana{" "}
          <code className="rounded bg-muted px-1">{`{q, a}`}</code>.
        </p>
        <div className="mt-3 grid gap-3">
          <Textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={EXAMPLE_IMPORT}
            className="min-h-32 font-mono text-xs"
            aria-label="Tempel JSON dataset"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload aria-hidden="true" className="h-4 w-4" />
              Pilih file .json
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                onFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="ghost" onClick={() => setImportText(EXAMPLE_IMPORT)}>
              Isi contoh
            </Button>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <span>Mode:</span>
              <Button
                size="sm"
                variant={importMode === "merge" ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => setImportMode("merge")}
              >
                Gabung
              </Button>
              <Button
                size="sm"
                variant={importMode === "replace" ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => setImportMode("replace")}
              >
                Ganti total
              </Button>
            </div>
          </div>
          <Button onClick={() => void doImport()} disabled={!importText.trim() || importMut.isPending} className="w-fit">
            {importMut.isPending ? "Mengimpor…" : `Impor (${importMode === "merge" ? "gabung" : "ganti total"})`}
          </Button>
        </div>
      </Card>

      {/* ===== Konsol uji ===== */}
      <Card className="p-4 sm:p-6">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Play aria-hidden="true" className="h-4 w-4 text-amber-500" />
          Konsol Uji
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Uji pertanyaan persis seperti pengunjung — pipeline penuh (overlay kustom + model aktif + personalisasi nama).
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={testUser}
            onChange={(e) => setTestUser(e.target.value)}
            placeholder="Nama pengguna (mis. Dearly)"
            className="sm:w-52"
            aria-label="Nama pengguna untuk simulasi"
          />
          <Input
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void runTest();
              }
            }}
            placeholder='Coba: "hai, apakah kamu mengenal saya" / "berapa total game" / "harga ff 350"'
            aria-label="Pertanyaan uji"
          />
          <Button onClick={() => void runTest()} disabled={testBusy || !testText.trim()} className="shrink-0">
            {testBusy ? "Berpikir…" : "Tanya"}
          </Button>
        </div>
        {testLog.length > 0 && (
          <ul className="mt-4 max-h-96 space-y-3 overflow-y-auto pr-1" aria-label="Riwayat uji">
            {testLog.map((t, i) => (
              <li key={i} className="rounded-lg border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <MessageSquareText aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{t.text}</span>
                  <Badge variant="outline" className="ml-auto font-mono text-[10px]">
                    {t.intent}
                  </Badge>
                  <span className="tabular-nums text-muted-foreground">{(t.score * 100).toFixed(0)}%</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{t.answer}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ===== Reset ===== */}
      <Card className="p-4 sm:p-6">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <RotateCcw aria-hidden="true" className="h-4 w-4 text-amber-500" />
          Reset
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Kembalikan otak ke kondisi bawaan. Model hasil training bisa dibuang tanpa menghapus dataset.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setConfirmResetModel(true)} disabled={resetMut.isPending}>
            Buang model, pertahankan dataset
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={() => setConfirmResetAll(true)}
            disabled={resetMut.isPending}
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            Reset total
          </Button>
        </div>
      </Card>

      {/* ===== Dialog: editor intent ===== */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? `Ubah: ${editTarget.intent}` : "Intent kustom baru"}</DialogTitle>
            <DialogDescription>
              Intent kustom menang atas jawaban bawaan saat pertanyaan mirip. Prefiks{" "}
              <code className="rounded bg-muted px-1">security.</code> / <code className="rounded bg-muted px-1">off.</code> dilarang.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ai-intent">Nama intent</Label>
              <Input
                id="ai-intent"
                value={form.intent}
                onChange={(e) => setForm((f) => ({ ...f, intent: e.target.value }))}
                placeholder="mis. faq.ongkir"
                className="font-mono text-xs"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-utterances">Contoh kalimat (satu per baris, min. 1)</Label>
              <Textarea
                id="ai-utterances"
                value={form.utterances}
                onChange={(e) => setForm((f) => ({ ...f, utterances: e.target.value }))}
                placeholder={"apakah ada ongkir\nbiaya kirim berapa\nperlu bayar ongkos kirim gak"}
                className="min-h-24 text-xs"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-answer">Jawaban (mendukung placeholder {"{name}"})</Label>
              <Textarea
                id="ai-answer"
                value={form.answer}
                onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
                placeholder="Tidak ada ongkir sama sekali, {name}! Semua produk digital."
                className="min-h-20 text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Batal
            </Button>
            <Button onClick={() => void saveIntent()} disabled={datasetMut.isPending}>
              {datasetMut.isPending ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Konfirmasi latih ulang ===== */}
      <AlertDialog open={confirmTrain} onOpenChange={setConfirmTrain}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Latih ulang otak AI?</AlertDialogTitle>
            <AlertDialogDescription>
              Training berjalan ± 10-30 detik dengan corpus bawaan + katalog live + {dataset.length} intent kustom. Model
              baru otomatis menggantikan yang lama setelah selesai.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runTrain()} className="bg-amber-600 text-white hover:bg-amber-500">
              Ya, latih sekarang
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== Konfirmasi reset ===== */}
      <AlertDialog open={confirmResetModel} onOpenChange={setConfirmResetModel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Buang model hasil training?</AlertDialogTitle>
            <AlertDialogDescription>
              Model kustom dihapus — situs kembali memakai model bawaan repo. Dataset kustom ({dataset.length} intent)
              dipertahankan dan tetap hidup via overlay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doReset(true)}>Buang model</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmResetAll} onOpenChange={setConfirmResetAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset total otak AI?</AlertDialogTitle>
            <AlertDialogDescription>
              Menghapus model hasil training DAN seluruh dataset kustom ({dataset.length} intent). Tindakan ini tidak
              bisa dibatalkan — kamu perlu mengimpor ulang datasetnya.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void doReset(false)}
              className={cn("bg-destructive text-white hover:bg-destructive/90")}
            >
              Ya, hapus semua
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

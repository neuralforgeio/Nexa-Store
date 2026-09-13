"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useChatConsole, useChatOwnerMutation } from "@/lib/queries";
import { formatWib } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import { CheckCheck, MessagesSquare, Search, Send, Trash2, UserRound } from "lucide-react";

/**
 * Konsol Obrolan (v1.6.0) — sisi pemilik live chat.
 * Pesan dari widget storefront dan balasan Telegram berada di satu alur.
 * Baru: pencarian percakapan, hapus satu percakapan, dan hapus semua
 * percakapan (dari sisi pemilik).
 */
export function DevChat() {
  const { data, isPending, isError, refetch } = useChatConsole(true);
  const mutation = useChatOwnerMutation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [pendingClearOne, setPendingClearOne] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const conversations = data?.conversations ?? [];

  // Pencarian: filter berdasarkan nama, isi pesan terakhir, atau id.
  const q = search.trim().toLowerCase();
  const filtered = q
    ? conversations.filter(
        (c) =>
          (c.name ?? "").toLowerCase().includes(q) ||
          c.lastText.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          c.messages.some((m) => m.text.toLowerCase().includes(q))
      )
    : conversations;

  // Default selection derives from the data — no effect needed.
  const activeId = selectedId ?? filtered[0]?.id ?? conversations[0]?.id ?? null;

  // Auto-mark the open conversation as read.
  useEffect(() => {
    const active = conversations.find((c) => c.id === activeId);
    if (active && active.unreadByOwner > 0 && !mutation.isPending) {
      mutation.mutate({ conversationId: active.id, action: "markRead" });
    }
  }, [activeId, conversations.map((c) => `${c.id}:${c.unreadByOwner}`).join(",")]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );

  // Keep the thread pinned to the newest message.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.messages.length, activeId]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !active || mutation.isPending) return;
    try {
      await mutation.mutateAsync({ conversationId: active.id, action: "reply", text });
      setDraft("");
    } catch (e) {
      toast.error("Balasan gagal terkirim", { description: (e as Error).message });
    }
  };

  function clearOne(conversationId: string) {
    mutation.mutate(
      { conversationId, action: "clearOne" },
      {
        onSuccess: () => {
          toast.success("Percakapan dihapus.");
          setPendingClearOne(null);
          if (conversationId === activeId) setSelectedId(null);
        },
        onError: (e) => toast.error("Gagal menghapus percakapan", { description: (e as Error).message }),
      }
    );
  }

  function clearAll() {
    mutation.mutate(
      { action: "clearAll" },
      {
        onSuccess: (res) => {
          toast.success(`Semua obrolan dihapus (${res.clearedCount ?? 0} percakapan).`);
          setConfirmClearAll(false);
          setSelectedId(null);
        },
        onError: (e) => toast.error("Gagal menghapus semua obrolan", { description: (e as Error).message }),
      }
    );
  }

  if (isPending) return <LoadingState label="Memuat percakapan…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Obrolan tidak dapat dimuat"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Obrolan Langsung</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pesan dari widget chat storefront dan balasan Telegram berada di satu alur.
            {data.unreadTotal > 0 ? (
              <span className="ml-1.5 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">
                {data.unreadTotal} belum dibaca
              </span>
            ) : null}
          </p>
        </div>
        {conversations.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-red-600 hover:text-red-700 dark:text-red-400"
            onClick={() => setConfirmClearAll(true)}
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            Hapus semua obrolan
          </Button>
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* Conversation list — min-w-0 wajib: tanpa itu min-content teks panjang
            (lastText truncate) melebarkan kolom grid hingga overflow mobile. */}
        <div className="min-w-0 rounded-xl border bg-card/40">
          <div className="border-b border-border/60 px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MessagesSquare aria-hidden="true" className="h-3.5 w-3.5" />
              Percakapan · {filtered.length}
              {q && conversations.length !== filtered.length ? ` / ${conversations.length}` : ""}
            </p>
          </div>
          <div className="border-b border-border/60 p-2.5">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama / isi pesan…"
                aria-label="Cari percakapan"
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {conversations.length === 0
                ? "Belum ada pengunjung yang memulai obrolan."
                : "Tidak ada percakapan yang cocok."}
            </p>
          ) : (
            <ul className="scroll-slim max-h-96 overflow-y-auto lg:max-h-[480px]">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 border-b border-border/40 px-4 py-3 text-left transition-colors last:border-0",
                      c.id === activeId ? "bg-primary/10" : "hover:bg-accent/50"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <UserRound aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {c.name ?? "Tanpa nama"}
                      </span>
                      {c.unreadByOwner > 0 ? (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold tabular text-white">
                          {c.unreadByOwner}
                        </span>
                      ) : null}
                    </span>
                    <span className={cn("truncate text-xs", c.unreadByOwner > 0 ? "font-medium text-foreground/80" : "text-muted-foreground")}>
                      {c.lastFrom === "owner" ? "Kamu: " : ""}
                      {c.lastText || "(kosong)"}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70">
                      {formatWib(new Date(c.lastMessageAt))} · {c.messageCount} pesan
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Thread */}
        <div className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border bg-card/40">
          {active ? (
            <>
              <div className="flex flex-none items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{active.name ?? "Tanpa nama"}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">{active.id}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-red-600 hover:text-red-700 dark:text-red-400"
                    onClick={() => setPendingClearOne(active.id)}
                  >
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    Hapus
                  </Button>
                  <CheckCheck aria-hidden="true" className="h-4 w-4 text-primary/60" />
                </div>
              </div>
              <div ref={threadRef} className="scroll-slim min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
                {active.messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.from === "owner" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                        m.from === "owner"
                          ? "rounded-br-md bg-primary text-primary-foreground"
                          : "rounded-bl-md border bg-muted/60"
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.text}</p>
                      <p
                        className={cn(
                          "mt-1 text-right text-[10px] tabular",
                          m.from === "owner" ? "text-primary-foreground/70" : "text-muted-foreground"
                        )}
                      >
                        {formatWib(new Date(m.at))}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex-none border-t border-border/60 px-3 py-3">
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Tulis balasan…"
                    aria-label="Tulis balasan"
                    maxLength={800}
                  />
                  <Button type="submit" size="icon" disabled={!draft.trim() || mutation.isPending} aria-label="Kirim balasan" className="h-9 w-9 shrink-0">
                    <Send aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <MessagesSquare aria-hidden="true" className="h-8 w-8 text-muted-foreground/40" />
              <p className="max-w-xs text-sm text-muted-foreground">
                Pilih percakapan di kiri, atau buka store dan kirim pesan dari widget chat
                untuk mencobanya.
              </p>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={pendingClearOne !== null} onOpenChange={(o) => !o && setPendingClearOne(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus percakapan ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Seluruh pesan pada percakapan ini akan dihapus permanen dari sisi
              pemilik. Pengunjung tidak akan melihat riwayatnya lagi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => pendingClearOne && clearOne(pendingClearOne)}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmClearAll} onOpenChange={setConfirmClearAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus SEMUA obrolan?</AlertDialogTitle>
            <AlertDialogDescription>
              Seluruh {conversations.length} percakapan — termasuk milik semua
              pengunjung — akan dihapus permanen. Tindakan ini tidak bisa
              dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={clearAll}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Menghapus…" : "Hapus semua"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

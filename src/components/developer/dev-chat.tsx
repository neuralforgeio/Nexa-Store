"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingState, ErrorState } from "@/components/shared/state-views";
import { useChatConsole, useChatOwnerMutation } from "@/lib/queries";
import { formatWib } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import { MessagesSquare, Send, UserRound, CheckCheck } from "lucide-react";

/**
 * Developer chat console (v1.3.0) — the owner side of live chat.
 * Conversations from the storefront widget and Telegram replies share one
 * stream. Polls every 8s while open; unread badges mark what's new.
 */
export function DevChat() {
  const { data, isPending, isError, refetch } = useChatConsole(true);
  const mutation = useChatOwnerMutation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  const conversations = data?.conversations ?? [];

  // Default selection derives from the data — no effect needed.
  const activeId = selectedId ?? conversations[0]?.id ?? null;

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
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight">Obrolan Langsung</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pesan dari widget chat storefront dan balasan Telegram berada di satu alur.
          {data.unreadTotal > 0 ? (
            <span className="ml-1.5 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">
              {data.unreadTotal} belum dibaca
            </span>
          ) : null}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* Conversation list */}
        <div className="rounded-xl border bg-card/40">
          <div className="border-b border-border/60 px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MessagesSquare aria-hidden="true" className="h-3.5 w-3.5" />
              Percakapan · {conversations.length}
            </p>
          </div>
          {conversations.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Belum ada pengunjung yang memulai obrolan.
            </p>
          ) : (
            <ul className="scroll-slim max-h-96 overflow-y-auto lg:max-h-[520px]">
              {conversations.map((c) => (
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
        <div className="flex min-h-[420px] flex-col overflow-hidden rounded-xl border bg-card/40">
          {active ? (
            <>
              <div className="flex flex-none items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{active.name ?? "Tanpa nama"}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">{active.id}</p>
                </div>
                <CheckCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-primary/60" />
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
    </div>
  );
}

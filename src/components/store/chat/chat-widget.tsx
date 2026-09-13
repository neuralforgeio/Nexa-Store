"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import type { Socket } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageCircle, Send, X, ShieldCheck } from "lucide-react";
import { track } from "@/lib/analytics/tracker";
import { cn } from "@/lib/utils";

/**
 * Live chat widget (v1.3.0) — visitor ↔ store owner.
 *
 * Delivery strategy: WebSocket to the bot service when the environment allows
 * it (panel sandbox gateway), HTTP polling everywhere else — production
 * included. Sending always goes through POST /api/chat/messages so
 * validation + rate limiting stay server-side.
 */

const TOKEN_KEY = "nexa.chat.token";
const NAME_KEY = "nexa.chat.name";
const SEEN_KEY = "nexa.chat.seen";
const WS_QUERY = "/?XTransformPort=3005";

type ChatMessageDto = { id: string; from: "user" | "owner"; text: string; at: string };

function loadToken(): string {
  try {
    const existing = window.localStorage.getItem(TOKEN_KEY);
    if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    window.localStorage.setItem(TOKEN_KEY, token);
    return token;
  } catch {
    return "0".repeat(32);
  }
}

export function ChatWidget() {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [name, setName] = useState("");
  const [nameEdit, setNameEdit] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(0);
  const [wsLive, setWsLive] = useState(false);
  const tokenRef = useRef<string>("");
  const seenAtRef = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const openRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const focusNameRef = useRef(false);

  useEffect(() => {
    tokenRef.current = loadToken();
    try {
      const stored = window.localStorage.getItem(NAME_KEY);
      if (stored) {
        setName(stored);
        // Ada nama tersimpan → tampilkan sebagai chip identitas (bukan input).
        setNameEdit(false);
      }
      seenAtRef.current = window.localStorage.getItem(SEEN_KEY) ?? "";
    } catch {
      // ignore
    }
  }, []);

  // Fokus ke input nama hanya saat pengguna eksplisit minta "Ubah" —
  // jangan menyulut papan ketik mobile begitu panel dibuka.
  useEffect(() => {
    if (nameEdit && focusNameRef.current) {
      focusNameRef.current = false;
      nameInputRef.current?.focus();
    }
  }, [nameEdit]);

  useEffect(() => {
    openRef.current = open;
    if (open) setUnread(0);
  }, [open]);

  const mergeMessages = useCallback((incoming: ChatMessageDto[]) => {
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      const merged = [...map.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      return merged.slice(-80);
    });
    // Unread: owner messages newer than what this device has seen, panel closed.
    const newestOwner = incoming.filter((m) => m.from === "owner").map((m) => m.at).sort().pop();
    if (newestOwner && (!seenAtRef.current || newestOwner > seenAtRef.current)) {
      if (!openRef.current) setUnread((n) => Math.min(n + 1, 9));
      if (openRef.current) {
        seenAtRef.current = newestOwner;
        try {
          window.localStorage.setItem(SEEN_KEY, newestOwner);
        } catch {
          // ignore
        }
      }
    }
  }, []);

  // ----- HTTP polling (always on; the always-works path) -----
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/chat/messages?token=${tokenRef.current}`);
        const json = (await res.json()) as { ok: boolean; data?: { messages: ChatMessageDto[] } };
        if (!cancelled && json.ok && json.data) mergeMessages(json.data.messages);
      } catch {
        // network hiccup — next tick retries
      }
    };
    void poll();
    const interval = setInterval(poll, openRef.current ? 6_000 : 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mergeMessages, open]);

  // ----- WebSocket fast-path (sandbox/preview gateway; fails silently elsewhere) -----
  useEffect(() => {
    if (!open || socketRef.current) return;
    let disposed = false;
    let socket: Socket | null = null;
    void (async () => {
      try {
        const { io } = await import("socket.io-client");
        if (disposed) return;
        socket = io(WS_QUERY, {
          transports: ["websocket", "polling"],
          reconnection: true,
          reconnectionAttempts: 3,
          reconnectionDelay: 2500,
          timeout: 5000,
        });
        socketRef.current = socket;
        socket.on("connect", () => {
          setWsLive(true);
          socket?.emit("chat:join", { token: tokenRef.current });
        });
        socket.on("disconnect", () => setWsLive(false));
        socket.on("connect_error", () => setWsLive(false));
        socket.on("chat:message", (payload: { message: ChatMessageDto }) => {
          if (payload?.message) mergeMessages([payload.message]);
        });
      } catch {
        // socket.io unavailable → polling covers delivery
      }
    })();
    return () => {
      disposed = true;
      socket?.removeAllListeners();
      socket?.disconnect();
      socketRef.current = null;
      setWsLive(false);
    };
  }, [open, mergeMessages]);

  // Mark seen whenever the panel is open and messages flow in.
  useEffect(() => {
    if (!open) return;
    const last = messages[messages.length - 1];
    if (last && (!seenAtRef.current || last.at > seenAtRef.current)) {
      seenAtRef.current = last.at;
      try {
        window.localStorage.setItem(SEEN_KEY, last.at);
      } catch {
        // ignore
      }
    }
  }, [open, messages]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const trimmedName = name.trim().slice(0, 40);
      if (trimmedName) {
        try {
          window.localStorage.setItem(NAME_KEY, trimmedName);
        } catch {
          // ignore
        }
      }
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: tokenRef.current, text, ...(trimmedName ? { name: trimmedName } : {}) }),
      });
      const json = (await res.json()) as { ok: boolean; data?: { message: ChatMessageDto }; error?: { message: string } };
      if (!json.ok || !json.data?.message) {
        throw new Error(json.error?.message ?? "Pesan gagal terkirim.");
      }
      mergeMessages([json.data.message]);
      setDraft("");
    } catch (e) {
      toast.error("Pesan tidak terkirim", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  const panel = useMemo(
    () => (
      <motion.div
        role="dialog"
        aria-label="Obrolan dengan store"
        initial={reduced ? { opacity: 1 } : { opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="fixed inset-x-3 bottom-3 z-50 flex h-[min(70dvh,540px)] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[380px]"
      >
        {/* Header */}
        <div className="flex flex-none items-center gap-2.5 border-b border-border/70 bg-background/95 px-4 py-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 font-display text-sm font-bold text-primary"
          >
            N
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm font-semibold">Obrolan Nexa Store</p>
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", wsLive ? "bg-emerald-500" : "bg-amber-500")} />
              {wsLive ? "tersambung langsung" : "dijawab oleh pemilik store"}
            </p>
          </div>
          <button
            type="button"
            aria-label="Tutup obrolan"
            onClick={() => setOpen(false)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="scroll-slim min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                <MessageCircle className="h-5 w-5" />
              </span>
              <p className="max-w-[260px] text-sm leading-relaxed text-muted-foreground">
                Halo! Ada yang bisa dibantu? Tulis pesanmu di sini — pemilik
                store akan membalas langsung dari dashboard.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={cn("flex", m.from === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm",
                    m.from === "user"
                      ? "rounded-br-md bg-primary text-primary-foreground"
                      : "rounded-bl-md border bg-muted/60"
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  <p
                    className={cn(
                      "mt-1 text-right text-[10px] tabular",
                      m.from === "user" ? "text-primary-foreground/70" : "text-muted-foreground"
                    )}
                  >
                    {new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date(m.at))}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Composer */}
        <div className="flex-none border-t border-border/70 bg-background/95 px-3 py-3">
          {nameEdit || !name.trim() ? (
            <Input
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                const trimmed = name.trim();
                if (!trimmed) return; // kosong → input tetap terbuka
                setNameEdit(false);
                try {
                  window.localStorage.setItem(NAME_KEY, trimmed);
                } catch {
                  // ignore
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              placeholder="Nama kamu (opsional)"
              aria-label="Nama kamu (opsional)"
              className="mb-2 h-8 text-xs"
              maxLength={40}
            />
          ) : (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1">
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                Sebagai{" "}
                <span className="font-semibold text-foreground">{name.trim()}</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  focusNameRef.current = true;
                  setNameEdit(true);
                }}
                className="shrink-0 rounded-sm text-[11px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Ubah
              </button>
            </div>
          )}
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
              placeholder="Tulis pesan…"
              aria-label="Tulis pesan"
              maxLength={800}
              className="min-h-9"
            />
            <Button type="submit" size="icon" disabled={!draft.trim() || sending} aria-label="Kirim pesan" className="h-9 w-9 shrink-0">
              <Send aria-hidden="true" className="h-4 w-4" />
            </Button>
          </form>
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <ShieldCheck aria-hidden="true" className="h-3 w-3 shrink-0" />
            Identitas perangkat acak — tanpa akun, tanpa data pribadi.
          </p>
        </div>
      </motion.div>
    ),
    [reduced, wsLive, messages, name, nameEdit, draft, sending]
  );

  return (
    <>
      <AnimatePresence>{open ? panel : null}</AnimatePresence>
      <motion.button
        type="button"
        aria-label={open ? "Tutup obrolan" : "Buka obrolan dengan store"}
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) {
            setUnread(0);
            track("chat_open");
          }
        }}
        whileHover={reduced ? undefined : { scale: 1.06 }}
        whileTap={reduced ? undefined : { scale: 0.94 }}
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary text-primary-foreground shadow-xl transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:bottom-6 sm:right-6"
      >
        {open ? (
          <X aria-hidden="true" className="h-5 w-5" />
        ) : (
          <MessageCircle aria-hidden="true" className="h-5 w-5" />
        )}
        {unread > 0 && !open ? (
          <span
            aria-label={`${unread} pesan belum dibaca`}
            className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-primary bg-destructive px-1 text-[10px] font-bold tabular text-white"
          >
            {unread}
          </span>
        ) : null}
      </motion.button>
    </>
  );
}

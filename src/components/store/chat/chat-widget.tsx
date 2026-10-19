"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import type { Socket } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandMark } from "@/components/shared/brand-mark";
import {
  Bell,
  BellOff,
  Bot,
  BotOff,
  Check,
  MessageCircle,
  Send,
  Trash2,
  X,
  ShieldCheck,
} from "lucide-react";
import { track } from "@/lib/analytics/tracker";
import { cn } from "@/lib/utils";

/**
 * Live chat widget (v1.3.0) — visitor ↔ store owner.
 *
 * Delivery strategy: WebSocket to the bot service when the environment allows
 * it (panel sandbox gateway), HTTP polling everywhere else — production
 * included. Sending always goes through POST /api/chat/messages so
 * validation + rate limiting stay server-side.
 *
 * v1.15.0 — jawaban Nexa Bot muncul dengan animasi mengetik kata-demi-kata
 * (+ indikator “sedang mengetik”), dan ada tombol saklar AI di header: matikan
 * agar dijawab admin, nyalakan kembali kapan pun (permintaan pemilik).
 */

const TOKEN_KEY = "nexa.chat.token";
const NAME_KEY = "nexa.chat.name";
const SEEN_KEY = "nexa.chat.seen";
const PUSH_KEY = "nexa.chat.push";
const WS_QUERY = "/?XTransformPort=3005";

type ChatMessageDto = { id: string; from: "user" | "owner" | "bot"; text: string; at: string };

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
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [aiMode, setAiMode] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [botTyping, setBotTyping] = useState(false);
  const [animateIds, setAnimateIds] = useState<Set<string>>(() => new Set());
  const tokenRef = useRef<string>("");
  const seenAtRef = useRef<string>("");
  const knownIdsRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const openRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const focusNameRef = useRef(false);

  // Setujui/munculkan notifikasi browser (Web Push, v1.6.0).
  const togglePush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (pushOn) {
        // Matikan: berhenti berlangganan + hapus di server.
        try {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          if (sub) await sub.unsubscribe();
        } catch {
          // SW bisa absen — lanjut hapus di server.
        }
        await fetch("/api/chat/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "unsubscribe", token: tokenRef.current }),
        });
        setPushOn(false);
        try {
          window.localStorage.removeItem(PUSH_KEY);
        } catch {
          // ignore
        }
        toast.success("Notifikasi dimatikan");
        return;
      }

      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        toast.error("Browser ini tidak mendukung notifikasi.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.info("Izin notifikasi tidak diberikan", {
          description: "Kamu bisa mengaktifkannya nanti lewat ikon bel.",
        });
        return;
      }
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
      if (!publicKey) {
        toast.error("Notifikasi belum dikonfigurasi di server.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });
      const json = sub.toJSON();
      const res = await fetch("/api/chat/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "subscribe",
          token: tokenRef.current,
          subscription: { endpoint: json.endpoint, keys: json.keys },
          name: name.trim() || undefined,
        }),
      });
      const out = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!res.ok || !out.ok) throw new Error(out.error?.message ?? "Gagal menyimpan langganan.");
      setPushOn(true);
      try {
        window.localStorage.setItem(PUSH_KEY, "1");
      } catch {
        // ignore
      }
      toast.success("Notifikasi aktif", {
        description: "Kamu akan diberi tahu saat store membalas obrolanmu.",
      });
    } catch (e) {
      toast.error("Gagal mengatur notifikasi", { description: (e as Error).message });
    } finally {
      setPushBusy(false);
    }
  };

  // Bersihkan obrolan milik sendiri (v1.6.0).
  const clearChat = async () => {
    setConfirmClear(false);
    try {
      const res = await fetch("/api/chat/clear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: tokenRef.current }),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!res.ok || !json.ok) throw new Error(json.error?.message ?? "Gagal membersihkan obrolan.");
      setMessages([]);
      setUnread(0);
      toast.success("Obrolan dibersihkan");
    } catch (e) {
      toast.error("Gagal membersihkan obrolan", { description: (e as Error).message });
    }
  };

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
      // Push: cek cepat izin + langganan aktif (tanpa network).
      if (window.localStorage.getItem(PUSH_KEY) === "1" && "Notification" in window && Notification.permission === "granted") {
        setPushOn(true);
      } else {
        window.localStorage.removeItem(PUSH_KEY);
      }
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

  // v1.15.0 — saklar AI: matikan agar dijawab admin, nyalakan kembali oleh
  // siapa pun yang memakai widget ini (state global, dibatasi rate di server).
  const toggleAi = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    const next = !aiMode;
    try {
      const res = await fetch("/api/chat/ai-mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const json = (await res.json()) as { ok: boolean; data?: { aiAutoReply: boolean }; error?: { message: string } };
      if (!res.ok || !json.ok || typeof json.data?.aiAutoReply !== "boolean") {
        throw new Error(json.error?.message ?? "Gagal mengubah mode AI.");
      }
      setAiMode(json.data.aiAutoReply);
      toast.success(
        json.data.aiAutoReply ? "Nexa Bot aktif kembali" : "AI dimatikan",
        {
          description: json.data.aiAutoReply
            ? "Pesanmu langsung dijawab instan oleh asisten AI."
            : "Pesanmu akan dijawab oleh admin — mohon tunggu ya.",
        }
      );
    } catch (e) {
      toast.error("Gagal mengubah mode AI", { description: (e as Error).message });
    } finally {
      setAiBusy(false);
    }
  };

  const mergeMessages = useCallback((incoming: ChatMessageDto[]) => {
    // v1.15.0 — deteksi balasan bot BARU (bukan riwayat) untuk animasi ketik.
    const freshBotIds: string[] = [];
    for (const m of incoming) {
      if (knownIdsRef.current.has(m.id)) continue;
      knownIdsRef.current.add(m.id);
      if (firstLoadRef.current && m.from === "bot") freshBotIds.push(m.id);
    }
    firstLoadRef.current = true;
    if (freshBotIds.length > 0) {
      setAnimateIds((prev) => {
        const next = new Set(prev);
        for (const id of freshBotIds) next.add(id);
        return next;
      });
      setBotTyping(false);
    }
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
        const json = (await res.json()) as {
          ok: boolean;
          data?: { messages: ChatMessageDto[]; aiAutoReply?: boolean };
        };
        if (!cancelled && json.ok && json.data) {
          mergeMessages(json.data.messages);
          if (typeof json.data.aiAutoReply === "boolean") setAiMode(json.data.aiAutoReply);
        }
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
    // v1.15.0 — indikator “Nexa Bot sedang mengetik” selagi menunggu balasan.
    if (aiMode) setBotTyping(true);
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
      const json = (await res.json()) as {
        ok: boolean;
        data?: { message: ChatMessageDto; botMessage?: ChatMessageDto | null; aiAutoReply?: boolean };
        error?: { message: string };
      };
      if (!json.ok || !json.data?.message) {
        throw new Error(json.error?.message ?? "Pesan gagal terkirim.");
      }
      mergeMessages([json.data.message]);
      if (json.data.botMessage) {
        // Tunda sekejap agar terlihat "mengetik" — balasan instan mentah
        // membuat percakapan terasa aneh.
        await new Promise((r) => setTimeout(r, 450));
        mergeMessages([json.data.botMessage]);
      } else {
        setBotTyping(false);
      }
      if (typeof json.data.aiAutoReply === "boolean") setAiMode(json.data.aiAutoReply);
      setDraft("");
    } catch (e) {
      toast.error("Pesan tidak terkirim", { description: (e as Error).message });
    } finally {
      setSending(false);
      setBotTyping(false);
    }
  };

  // v1.15.0 — selesaikan animasi ketik per id (callback stabil untuk BotTypedText).
  const finishTyping = useCallback((id: string) => {
    setAnimateIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

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
          <BrandMark size={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm font-semibold">Obrolan Nexa Store</p>
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", wsLive ? "bg-emerald-500" : "bg-amber-500")} />
              {wsLive ? "tersambung langsung" : aiMode ? "dijawab instan oleh Nexa Bot" : "dijawab oleh pemilik store"}
            </p>
          </div>
          <button
            type="button"
            aria-label={aiMode ? "Matikan jawaban AI — biarkan admin menjawab" : "Nyalakan jawaban AI Nexa Bot"}
            aria-pressed={aiMode}
            title={
              aiMode
                ? "Nexa Bot menjawab instan — ketuk untuk mematikan (dijawab admin)"
                : "Dijawab admin — ketuk untuk menyalakan Nexa Bot"
            }
            onClick={() => void toggleAi()}
            disabled={aiBusy}
            className={cn(
              "rounded-md p-1.5 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50",
              aiMode ? "text-primary" : "text-muted-foreground"
            )}
          >
            {aiMode ? (
              <Bot aria-hidden="true" className="h-4 w-4" />
            ) : (
              <BotOff aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            aria-label={pushOn ? "Matikan notifikasi balasan" : "Nyalakan notifikasi balasan"}
            aria-pressed={pushOn}
            title={pushOn ? "Notifikasi aktif" : "Diberi tahu saat dibalas"}
            onClick={() => void togglePush()}
            disabled={pushBusy}
            className={cn(
              "rounded-md p-1.5 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50",
              pushOn ? "text-primary" : "text-muted-foreground"
            )}
          >
            {pushOn ? (
              <Bell aria-hidden="true" className="h-4 w-4" />
            ) : (
              <BellOff aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
          {messages.length > 0 ? (
            <button
              type="button"
              aria-label="Bersihkan obrolan"
              title="Bersihkan obrolan"
              onClick={() => setConfirmClear(true)}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Tutup obrolan"
            onClick={() => setOpen(false)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {confirmClear ? (
          <div role="alertdialog" aria-label="Konfirmasi bersihkan obrolan" className="flex-none border-b border-border/70 bg-muted/40 px-4 py-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Hapus seluruh pesan obrolan ini dari perangkatmu? Riwayat di sisi
              pemilik juga ikut terhapus.
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" variant="destructive" className="h-7 gap-1.5" onClick={() => void clearChat()}>
                <Check aria-hidden="true" className="h-3.5 w-3.5" />
                Ya, bersihkan
              </Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setConfirmClear(false)}>
                Batal
              </Button>
            </div>
          </div>
        ) : null}

        {/* Messages */}
        <div ref={scrollRef} className="scroll-slim min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                <MessageCircle className="h-5 w-5" />
              </span>
              <p className="max-w-[260px] text-sm leading-relaxed text-muted-foreground">
                Halo! Aku Nexa Bot — asisten AI NEXA STORE ⚡ Tanya harga game,
                cara top up, atau lacak pesanan. Mau dijawab manusia? Admin
                juga memantau obrolan ini.
              </p>
            </div>
          ) : (
            <>
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn("flex", m.from === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm",
                      m.from === "user"
                        ? "rounded-br-md bg-primary text-primary-foreground"
                        : m.from === "bot"
                          ? "rounded-bl-md border border-primary/25 bg-primary/[0.06]"
                          : "rounded-bl-md border bg-muted/60"
                    )}
                  >
                    {m.from === "bot" ? (
                      <p className="mb-1 flex items-center gap-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-primary/80">
                        <Bot aria-hidden="true" className="h-3 w-3" />
                        Nexa Bot
                      </p>
                    ) : null}
                    <BotTypedText
                      text={m.text}
                      id={m.id}
                      animate={m.from === "bot" && animateIds.has(m.id)}
                      onFinished={finishTyping}
                    />
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
              ))}
              {/* v1.15.0 — indikator Nexa Bot sedang mengetik. */}
              {botTyping ? (
                <div className="flex justify-start" aria-live="polite">
                  <div className="rounded-2xl rounded-bl-md border border-primary/25 bg-primary/[0.06] px-3.5 py-2.5 shadow-sm">
                    <span className="flex items-center gap-1.5">
                      <Bot aria-hidden="true" className="h-3 w-3 text-primary/80" />
                      {[0, 1, 2].map((i) => (
                        <motion.span
                          key={i}
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full bg-primary/70"
                          animate={reduced ? undefined : { opacity: [0.25, 1, 0.25] }}
                          transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }}
                        />
                      ))}
                      <span className="sr-only">Nexa Bot sedang mengetik</span>
                    </span>
                  </div>
                </div>
              ) : null}
            </>
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
    [reduced, wsLive, messages, name, nameEdit, draft, sending, pushOn, pushBusy, confirmClear, aiMode, aiBusy, botTyping, animateIds, finishTyping]
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

/**
 * v1.15.0 — teks balasan bot yang "mengetik" kata demi kata. Riwayat lama
 * (animate=false) langsung tampil penuh; reduced-motion dihormati.
 * onFinished stabil per-id supaya efek timer hanya berjali sekali.
 */
function BotTypedText({
  text,
  id,
  animate,
  onFinished,
}: {
  text: string;
  id: string;
  animate: boolean;
  onFinished: (id: string) => void;
}) {
  const reduced = useReducedMotion();
  const words = useMemo(() => text.match(/\S+\s*/g) ?? [text], [text]);
  const shouldAnimate = animate && !reduced;
  // null = tampil penuh (riwayat / reduced-motion / animasi selesai).
  const [revealed, setRevealed] = useState<number | null>(shouldAnimate ? 0 : null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!shouldAnimate || startedRef.current) return;
    startedRef.current = true;
    // Pesan panjang tetap selesai <= ±1,8 dtk; pendek mengetik santai.
    const perWord = Math.min(70, Math.max(16, 1800 / Math.max(words.length, 1)));
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setRevealed(i >= words.length ? null : i);
      if (i >= words.length) {
        clearInterval(timer);
        onFinished(id);
      }
    }, perWord);
    return () => clearInterval(timer);
  }, [shouldAnimate, words.length, onFinished, id]);

  const typing = revealed !== null && revealed < words.length;
  return (
    <p className="whitespace-pre-wrap break-words">
      {words.slice(0, typing ? revealed : words.length).join("")}
      {typing ? (
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse rounded-full bg-primary/80"
        />
      ) : null}
    </p>
  );
}

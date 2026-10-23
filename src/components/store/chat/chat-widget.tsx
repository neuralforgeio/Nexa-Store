"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import type { Socket } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCartUI } from "@/components/store/cart/cart-ui-context";
import { useCartStore } from "@/lib/cart/store";
import { MarkdownMessage } from "./markdown";
import { RobotAvatar, type RobotMood } from "./robot-avatar";
import {
  Bell,
  BellOff,
  Bot,
  BotOff,
  Check,
  Send,
  ShoppingCart,
  Sparkles,
  Trash2,
  X,
  ShieldCheck,
} from "lucide-react";
import { track } from "@/lib/analytics/tracker";
import { cn } from "@/lib/utils";

/**
 * Live chat widget (v1.18.0) — pengunjung ↔ Nexa Bot (agent AI) ↔ pemilik.
 *
 * Desain ulang penuh: panel kaca premium dengan maskot robot (mata mengikuti
 * kursor, animasi lompat), jawaban bot dirender sebagai MARKDOWN, dan agent
 * transaksi — "pesan 2000 diamonds ff" memasukkan produk ke keranjang,
 * "id saya 123…" mengisikan data akun ke item (aksi ephemeral dari respons
 * POST, tidak pernah dipersist → aman dari replay duplikat).
 *
 * Pengiriman tetap lewat POST /api/chat/messages (validasi + rate limit di
 * server); pengantaran instan via WebSocket bila lingkungan mengizinkan.
 */

const TOKEN_KEY = "nexa.chat.token";
const NAME_KEY = "nexa.chat.name";
const SEEN_KEY = "nexa.chat.seen";
const PUSH_KEY = "nexa.chat.push";
const WS_QUERY = "/?XTransformPort=3005";

type ChatMessageDto = { id: string; from: "user" | "owner" | "bot"; text: string; at: string };

/** Aksi agent dari bot (divalidasi server, ephemeral — tidak dipersist). */
type AddToCartAction = {
  type: "add_to_cart";
  productId: string;
  gameId: string;
  label: string;
  gameName: string;
  price: number;
  requiredFields: { key: string; label: string; required: boolean }[];
};
type FillDataAction = {
  type: "fill_data";
  productId: string;
  gameId: string;
  fields: Record<string, string>;
  customerName?: string;
};
type BotActionDto = AddToCartAction | FillDataAction;

const QUICK_CHIPS: { label: string; text: string }[] = [
  { label: "Daftar game", text: "daftar game" },
  { label: "Cara top up", text: "cara top up" },
  { label: "Termurah", text: "rekomendasi termurah" },
  { label: "Pesan contoh", text: "pesan 2000 diamonds free fire" },
];

const idrFmt = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

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
  /** Kartu aksi ephemeral per id pesan bot (add_to_cart → kartu produk). */
  const [actionCards, setActionCards] = useState<Record<string, AddToCartAction>>({});
  const [robotMood, setRobotMood] = useState<RobotMood>("alert");
  const tokenRef = useRef<string>("");
  const seenAtRef = useRef<string>("");
  const knownIdsRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(false);
  const executedActionsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const openRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const focusNameRef = useRef(false);
  const { setOpen: setCartOpen } = useCartUI();

  // -------------------------------------------------------------------
  // Agent: eksekusi aksi keranjang dari balasan bot.
  // -------------------------------------------------------------------
  const runAction = useCallback(
    (action: BotActionDto) => {
      const chatName = name.trim().slice(0, 80) || null;
      if (action.type === "add_to_cart") {
        const result = useCartStore.getState().addItem(action.productId, action.gameId);
        if (result.ok) {
          // Nama pengunjung chat langsung diisikan — mengurangi satu langkah.
          if (chatName) {
            useCartStore.getState().updateRecipient(result.id, { customerName: chatName });
          }
          toast.success("Masuk keranjang", {
            description: `${action.label} — ${action.gameName} · ${idrFmt(action.price)}`,
          });
          track("chat_agent_add_to_cart");
        } else {
          toast.error("Keranjang penuh", {
            description: "Maksimal 5 item per checkout — selesaikan dulu ya.",
          });
        }
        return;
      }
      if (action.type === "fill_data") {
        const state = useCartStore.getState();
        const items = state.items.filter((it) => it.productId === action.productId);
        const customerName = action.customerName?.trim() || chatName;
        if (items.length === 0) {
          // Item-nya sudah tidak ada (keranjang dikosongkan) — buat ulang lalu isi,
          // supaya tetap konsisten dengan jawaban bot.
          const added = useCartStore.getState().addItem(action.productId, action.gameId);
          if (added.ok) {
            useCartStore.getState().updateRecipient(added.id, {
              fields: action.fields,
              ...(customerName ? { customerName } : {}),
            });
          }
        } else {
          const target = items[items.length - 1];
          useCartStore.getState().updateRecipient(target.id, {
            fields: { ...target.recipient.fields, ...action.fields },
            ...(customerName ? { customerName } : {}),
          });
        }
        toast.success("Data akun tersimpan", {
          description: "Terisi otomatis di item keranjangmu.",
        });
        track("chat_agent_fill_data");
      }
    },
    [name]
  );

  // Setujui/munculkan notifikasi browser (Web Push).
  const togglePush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (pushOn) {
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

  // Bersihkan obrolan milik sendiri.
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
      setActionCards({});
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
        setNameEdit(false);
      }
      seenAtRef.current = window.localStorage.getItem(SEEN_KEY) ?? "";
      if (
        window.localStorage.getItem(PUSH_KEY) === "1" &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
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

  // Suasana robot: menunggu → mengetik; senang sekejap saat pesan terkirim.
  useEffect(() => {
    if (botTyping) setRobotMood("typing");
    else setRobotMood("alert");
  }, [botTyping]);

  // Saklar AI: matikan agar dijawab admin, nyalakan kembali kapan pun.
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
      const json = (await res.json()) as {
        ok: boolean;
        data?: { aiAutoReply: boolean };
        error?: { message: string };
      };
      if (!res.ok || !json.ok || typeof json.data?.aiAutoReply !== "boolean") {
        throw new Error(json.error?.message ?? "Gagal mengubah mode AI.");
      }
      setAiMode(json.data.aiAutoReply);
      toast.success(json.data.aiAutoReply ? "Nexa Bot aktif kembali" : "AI dimatikan", {
        description: json.data.aiAutoReply
          ? "Pesanmu langsung dijawab instan oleh asisten AI."
          : "Pesanmu akan dijawab oleh admin — mohon tunggu ya.",
      });
    } catch (e) {
      toast.error("Gagal mengubah mode AI", { description: (e as Error).message });
    } finally {
      setAiBusy(false);
    }
  };

  const mergeMessages = useCallback((incoming: ChatMessageDto[]) => {
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
  }, [messages, open, botTyping, actionCards]);

  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sending) return;
      setSending(true);
      if (aiMode) setBotTyping(true);
      // Robot senang sekejap saat menerima pesan.
      setRobotMood("happy");
      setTimeout(() => setRobotMood(aiMode ? "typing" : "alert"), 900);
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
          body: JSON.stringify({
            token: tokenRef.current,
            text,
            ...(trimmedName ? { name: trimmedName } : {}),
          }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          data?: {
            message: ChatMessageDto;
            botMessage?: ChatMessageDto | null;
            aiAutoReply?: boolean;
            botActions?: BotActionDto[];
          };
          error?: { message: string };
        };
        if (!json.ok || !json.data?.message) {
          throw new Error(json.error?.message ?? "Pesan gagal terkirim.");
        }
        mergeMessages([json.data.message]);
        if (json.data.botMessage) {
          // Tunda sekejap agar terlihat "mengetik".
          await new Promise((r) => setTimeout(r, 450));
          mergeMessages([json.data.botMessage]);
          // v1.18.0 — eksekusi aksi agent (sekali per pesan, dedupe by id).
          const botId = json.data.botMessage.id;
          const actions = json.data.botActions ?? [];
          actions.forEach((action, index) => {
            const dedupe = `${botId}:${index}`;
            if (executedActionsRef.current.has(dedupe)) return;
            executedActionsRef.current.add(dedupe);
            runAction(action);
            if (action.type === "add_to_cart") {
              setActionCards((prev) => ({ ...prev, [botId]: action }));
            }
          });
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
    },
    [sending, aiMode, name, mergeMessages, runAction]
  );

  // Selesaikan animasi ketik per id (callback stabil).
  const finishTyping = useCallback((id: string) => {
    setAnimateIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const statusText = !aiMode
    ? "Dijawab pemilik store"
    : wsLive
      ? "AI Agent · tersambung langsung"
      : "AI Agent · online 24 jam";

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.div
            key="chat-panel"
            role="dialog"
            aria-label="Obrolan dengan Nexa Bot"
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed inset-x-3 bottom-3 z-50 flex h-[min(76dvh,620px)] flex-col overflow-hidden rounded-2xl border bg-card/95 shadow-2xl shadow-black/25 backdrop-blur-xl sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[400px]"
          >
            {/* Strip gradien aksen */}
            <div
              aria-hidden="true"
              className="h-[3px] w-full shrink-0 bg-gradient-to-r from-transparent via-primary/80 to-transparent"
            />

            {/* Header */}
            <div className="flex flex-none items-center gap-3 border-b border-border/70 bg-background/85 px-4 py-3">
              <div className="relative shrink-0">
                <RobotAvatar size={40} mood={robotMood} trackPointer animateJump={false} />
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                    aiMode ? "bg-emerald-500" : "bg-muted-foreground/60"
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-semibold tracking-tight">Nexa Bot</p>
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      botTyping ? "animate-pulse bg-primary" : aiMode ? "bg-emerald-500" : "bg-muted-foreground/60"
                    )}
                  />
                  {botTyping ? "sedang mengetik…" : statusText}
                </p>
              </div>
              <button
                type="button"
                aria-label={aiMode ? "Matikan jawaban AI — biarkan admin menjawab" : "Nyalakan jawaban AI Nexa Bot"}
                aria-pressed={aiMode}
                title={aiMode ? "Nexa Bot menjawab instan — ketuk untuk mematikan" : "Dijawab admin — ketuk untuk menyalakan Nexa Bot"}
                onClick={() => void toggleAi()}
                disabled={aiBusy}
                className={cn(
                  "rounded-lg p-2 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50",
                  aiMode ? "text-primary" : "text-muted-foreground"
                )}
              >
                {aiMode ? <Bot aria-hidden="true" className="h-4 w-4" /> : <BotOff aria-hidden="true" className="h-4 w-4" />}
              </button>
              <button
                type="button"
                aria-label={pushOn ? "Matikan notifikasi balasan" : "Nyalakan notifikasi balasan"}
                aria-pressed={pushOn}
                title={pushOn ? "Notifikasi aktif" : "Diberi tahu saat dibalas"}
                onClick={() => void togglePush()}
                disabled={pushBusy}
                className={cn(
                  "rounded-lg p-2 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50",
                  pushOn ? "text-primary" : "text-muted-foreground"
                )}
              >
                {pushOn ? <Bell aria-hidden="true" className="h-4 w-4" /> : <BellOff aria-hidden="true" className="h-4 w-4" />}
              </button>
              {messages.length > 0 ? (
                <button
                  type="button"
                  aria-label="Bersihkan obrolan"
                  title="Bersihkan obrolan"
                  onClick={() => setConfirmClear(true)}
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Tutup obrolan"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>

            {confirmClear ? (
              <div
                role="alertdialog"
                aria-label="Konfirmasi bersihkan obrolan"
                className="flex-none border-b border-border/70 bg-muted/40 px-4 py-3"
              >
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Hapus seluruh pesan obrolan ini dari perangkatmu? Riwayat di sisi pemilik juga ikut terhapus.
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
            <div ref={scrollRef} className="scroll-slim min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center gap-4 py-6 text-center">
                  <RobotAvatar size={72} mood="alert" trackPointer />
                  <div>
                    <p className="font-display text-base font-semibold tracking-tight">
                      Halo{name.trim() ? `, ${name.trim().split(" ")[0]}` : ""}! Saya Nexa Bot
                    </p>
                    <p className="mx-auto mt-1.5 max-w-[290px] text-[13px] leading-relaxed text-muted-foreground">
                      Agent AI NEXA STORE — tanya harga, minta rekomendasi, atau{" "}
                      <span className="font-semibold text-foreground">langsung pesan</span> dan kumasukkan ke
                      keranjangmu.
                    </p>
                  </div>
                  <div className="grid w-full max-w-[310px] grid-cols-2 gap-2">
                    {QUICK_CHIPS.map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => void sendText(chip.text)}
                        className="group flex items-center justify-center gap-1.5 rounded-xl border border-border/70 bg-background/60 px-3 py-2.5 text-xs font-medium text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/[0.06] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-primary/70 transition-transform group-hover:scale-110" />
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((m) => (
                    <MessageRow
                      key={m.id}
                      message={m}
                      animate={m.from === "bot" && animateIds.has(m.id)}
                      actionCard={m.from === "bot" ? actionCards[m.id] : undefined}
                      onFinished={finishTyping}
                      onOpenCart={() => setCartOpen(true)}
                    />
                  ))}
                  {botTyping ? (
                    <div className="flex items-end gap-2.5" aria-live="polite">
                      <RobotAvatar size={28} mood="typing" animateJump={false} className="shrink-0" />
                      <div className="rounded-2xl rounded-tl-md border border-primary/20 bg-primary/[0.05] px-4 py-3 shadow-sm">
                        <span className="flex items-center gap-1.5">
                          {[0, 1, 2].map((i) => (
                            <motion.span
                              key={i}
                              aria-hidden="true"
                              className="h-1.5 w-1.5 rounded-full bg-primary/70"
                              animate={reduced ? undefined : { opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
                              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
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
            <div className="flex-none border-t border-border/70 bg-background/85 px-3.5 py-3">
              {nameEdit || !name.trim() ? (
                <Input
                  ref={nameInputRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => {
                    const trimmed = name.trim();
                    if (!trimmed) return;
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
                  className="mb-2 h-8 rounded-lg text-xs"
                  maxLength={40}
                />
              ) : (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1">
                  <p className="min-w-0 truncate text-xs text-muted-foreground">
                    Sebagai <span className="font-semibold text-foreground">{name.trim()}</span>
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
                  void sendText(draft);
                }}
              >
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Tulis pesan…"
                  aria-label="Tulis pesan"
                  maxLength={800}
                  className="h-10 rounded-xl border-border/80 bg-background/70 text-[13px] shadow-inner focus-visible:ring-primary/40"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!draft.trim() || sending}
                  aria-label="Kirim pesan"
                  className="h-10 w-10 shrink-0 rounded-xl shadow-md"
                >
                  <Send aria-hidden="true" className="h-4 w-4" />
                </Button>
              </form>
              <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground/70">
                <ShieldCheck aria-hidden="true" className="h-3 w-3 shrink-0" />
                Tanpa akun — data akun game hanya dipakai untuk memproses pesanan.
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Robot FAB — maskot dengan mata yang mengikuti kursor */}
      <AnimatePresence>
        {!open ? (
          <motion.button
            key="chat-fab"
            type="button"
            aria-label="Buka obrolan dengan Nexa Bot"
            aria-expanded={false}
            initial={reduced ? undefined : { opacity: 0, scale: 0.6, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 12 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={() => {
              setOpen(true);
              setUnread(0);
              track("chat_open");
            }}
            whileHover={reduced ? undefined : { scale: 1.05 }}
            whileTap={reduced ? undefined : { scale: 0.92 }}
            className="group fixed bottom-4 right-4 z-50 flex h-16 w-16 items-center justify-center rounded-[1.35rem] border border-primary/25 bg-card shadow-xl shadow-black/25 transition-shadow hover:shadow-primary/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:bottom-6 sm:right-6"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[1.35rem] bg-gradient-to-b from-primary/10 to-transparent"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -inset-1 rounded-[1.6rem] bg-primary/0 blur-lg transition-colors duration-500 group-hover:bg-primary/15"
            />
            <RobotAvatar size={46} mood={unread > 0 ? "happy" : "idle"} trackPointer animateJump />
            <span
              aria-hidden="true"
              className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-500"
            />
            {unread > 0 ? (
              <span
                aria-label={`${unread} pesan belum dibaca`}
                className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-card bg-destructive px-1 text-[10px] font-bold tabular text-white shadow-sm"
              >
                {unread}
              </span>
            ) : null}
          </motion.button>
        ) : null}
      </AnimatePresence>
    </>
  );
}

// ---------------------------------------------------------------------------
// Baris pesan
// ---------------------------------------------------------------------------

function timeOf(at: string) {
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
}

function MessageRow({
  message,
  animate,
  actionCard,
  onFinished,
  onOpenCart,
}: {
  message: ChatMessageDto;
  animate: boolean;
  actionCard?: AddToCartAction;
  onFinished: (id: string) => void;
  onOpenCart: () => void;
}) {
  if (message.from === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%]">
          <div className="rounded-2xl rounded-tr-md bg-gradient-to-br from-primary to-primary/85 px-3.5 py-2.5 text-[13px] leading-relaxed text-primary-foreground shadow-md shadow-primary/15">
            <p className="whitespace-pre-wrap break-words">{message.text}</p>
          </div>
          <p className="mt-1 px-1 text-right text-[10px] tabular text-muted-foreground/80">{timeOf(message.at)}</p>
        </div>
      </div>
    );
  }

  if (message.from === "owner") {
    return (
      <div className="flex gap-2.5">
        <span
          aria-hidden="true"
          className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border bg-muted/70 font-display text-[10px] font-bold text-muted-foreground"
        >
          AD
        </span>
        <div className="min-w-0 max-w-[85%]">
          <div className="rounded-2xl rounded-tl-md border bg-muted/50 px-3.5 py-2.5 shadow-sm">
            <p className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Admin · Pemilik
            </p>
            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/90">
              {message.text}
            </p>
          </div>
          <p className="mt-1 px-1 text-[10px] tabular text-muted-foreground/80">{timeOf(message.at)}</p>
        </div>
      </div>
    );
  }

  // Bot — jawaban markdown + kartu aksi agent.
  return (
    <div className="flex gap-2.5">
      <RobotAvatar size={28} mood="idle" animateJump={false} trackPointer={false} className="mt-1 shrink-0" />
      <div className="min-w-0 max-w-[88%]">
        <div className="rounded-2xl rounded-tl-md border border-primary/20 bg-primary/[0.05] px-3.5 py-3 shadow-sm">
          <BotTypedMarkdown
            text={message.text}
            id={message.id}
            animate={animate}
            onFinished={onFinished}
          />
          {actionCard ? <ActionCard action={actionCard} onOpenCart={onOpenCart} /> : null}
        </div>
        <p className="mt-1 px-1 text-[10px] tabular text-muted-foreground/80">{timeOf(message.at)}</p>
      </div>
    </div>
  );
}

/** Kartu produk di dalam balasan bot — bukti agent memasukkan item ke keranjang. */
function ActionCard({ action, onOpenCart }: { action: AddToCartAction; onOpenCart: () => void }) {
  const required = action.requiredFields.filter((f) => f.required);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.15 }}
      className="mt-3 overflow-hidden rounded-xl border border-primary/30 bg-card/90"
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
        >
          <ShoppingCart className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold leading-tight">{action.label}</p>
          <p className="text-[11px] text-muted-foreground">
            {action.gameName} · <span className="font-semibold text-foreground">{idrFmt(action.price)}</span>
          </p>
        </div>
        <Button
          size="sm"
          className="h-8 shrink-0 rounded-lg px-3 text-[11px]"
          onClick={() => {
            onOpenCart();
            track("chat_agent_open_cart");
          }}
        >
          Buka
        </Button>
      </div>
      {required.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-primary/15 bg-primary/[0.04] px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {required.length > 1 ? "Wajib diisi" : "Wajib diisi"}
          </span>
          {required.map((f) => (
            <span
              key={f.key}
              className="rounded-full border border-primary/25 bg-background/70 px-2 py-0.5 text-[10px] font-medium text-foreground/80"
            >
              {f.label}
            </span>
          ))}
        </div>
      ) : null}
    </motion.div>
  );
}

/**
 * Jawaban bot yang "mengetik" kata demi kata — teks mentah markdown
 * direveal progresif dan dirender sebagai markdown setiap framenya.
 * Riwayat lama langsung tampil penuh; reduced-motion dihormati.
 */
function BotTypedMarkdown({
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
  const [revealed, setRevealed] = useState<number | null>(shouldAnimate ? 0 : null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!shouldAnimate || startedRef.current) return;
    startedRef.current = true;
    // v1.21.0: total ~1.2 detik (dulu ~1.7) — jawaban panjang 5 langkah
    // terasa terpotong saat screenshot di tengah animasi.
    const perWord = Math.min(40, Math.max(10, 1200 / Math.max(words.length, 1)));
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
  const visible = typing ? words.slice(0, revealed).join("") : text;
  return (
    <div className="min-w-0">
      <MarkdownMessage text={visible} />
      {typing ? (
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse rounded-full bg-primary/80"
        />
      ) : null}
    </div>
  );
}

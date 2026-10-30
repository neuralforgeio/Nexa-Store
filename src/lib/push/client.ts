/**
 * Klien Web Push bersama (v1.21.0).
 *
 * Dipakai tombol "Aktifkan notifikasi" di langkah sukses pesanan (order
 * sheet & keranjang) dan halaman Lacak — alurnya identik dengan tombol bel
 * di widget chat: minta izin → daftarkan service worker → berlangganan
 * (VAPID) → simpan endpoint ke data store "push-subs" per percakapan.
 *
 * Token percakapan = identitas perangkat ini (32-hex, localStorage). Token
 * yang sama dikirim saat membuat pesanan sehingga perubahan status pesanan
 * tahu ke device mana notifikasi dikirim.
 */

export const CHAT_TOKEN_KEY = "nexa.chat.token";
export const PUSH_FLAG_KEY = "nexa.push.on";

const TOKEN_RE = /^[a-f0-9]{32}$/;

export type EnablePushResult = "granted" | "denied" | "unsupported" | "unconfigured" | "error";

export function readChatToken(): string | null {
  try {
    const v = window.localStorage.getItem(CHAT_TOKEN_KEY);
    return TOKEN_RE.test(v ?? "") ? v : null;
  } catch {
    return null;
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Token percakapan device ini — dibuat bila belum ada (tanpa membuka chat). */
export function readOrCreateChatToken(): string | null {
  try {
    const existing = readChatToken();
    if (existing) return existing;
    const token = randomToken();
    window.localStorage.setItem(CHAT_TOKEN_KEY, token);
    return token;
  } catch {
    return null;
  }
}

export function pushFlagOn(): boolean {
  try {
    return window.localStorage.getItem(PUSH_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

async function postSubscribe(
  action: "subscribe" | "unsubscribe",
  token: string,
  subscription?: { endpoint: string; keys?: Record<string, string> }
): Promise<boolean> {
  try {
    const res = await fetch("/api/chat/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        action === "subscribe" ? { action, token, subscription } : { action, token }
      ),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Aktifkan notifikasi untuk perangkat ini (idempoten — aman dipanggil
 * berkali-kali; langganan lama dipakai ulang bila masih ada).
 */
export async function enablePushNotifications(): Promise<EnablePushResult> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
    if (typeof Notification === "undefined") return "unsupported";
    if (Notification.permission === "denied") return "denied";
    if (Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return "denied";
    }

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
    if (!publicKey) return "unconfigured";

    const token = readOrCreateChatToken();
    if (!token) return "error";

    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });
    }
    const json = sub.toJSON();
    if (!json.endpoint) return "error";

    const ok = await postSubscribe("subscribe", token, {
      endpoint: json.endpoint,
      keys: json.keys as Record<string, string> | undefined,
    });
    if (!ok) return "error";

    try {
      window.localStorage.setItem(PUSH_FLAG_KEY, "1");
    } catch {
      // flag gagal tersimpan — langganan tetap aktif di server
    }
    return "granted";
  } catch {
    return "error";
  }
}

/** Matikan notifikasi device ini (langganan lokal + catatan server). */
export async function disablePushNotifications(): Promise<void> {
  const token = readChatToken();
  if (token) await postSubscribe("unsubscribe", token);
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    }
  } catch {
    // SW bisa absen — catatan server sudah dihapus
  }
  try {
    window.localStorage.removeItem(PUSH_FLAG_KEY);
  } catch {
    // abaikan
  }
}

/* Nexa Store service worker — Web Push (v1.6.0 → v1.21.0).
 *
 * Menangani push notification untuk pengunjung yang menyetujui notifikasi:
 * balasan admin (manusia), balasan Nexa Bot (AI), dan perubahan status
 * pesanan. Klik notifikasi membuka/memfokuskan toko lalu mengarah ke URL
 * terkait (chat atau resi pesanan).
 *
 * v1.21.0: payload dengan skipWhenVisible=true (balasan bot) TIDAK muncul
 * saat tab toko sedang terbuka dan terlihat — pengguna sudah membaca
 * balasannya di layar, notifikasi akan mengganggu. Saat tab tersembunyi /
 * ditutup, notifikasi tetap muncul normal.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Nexa Store", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Nexa Store";
  const body = data.body || "";
  const url = data.url || "/";
  const skipWhenVisible = data.skipWhenVisible === true;

  event.waitUntil(
    (async () => {
      if (skipWhenVisible) {
        try {
          const clientList = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          });
          if (clientList.some((c) => c.visibilityState === "visible")) {
            // Tab toko sedang terlihat — pengguna sudah membaca balasannya.
            return;
          }
        } catch {
          // matchAll gagal → tampilkan notifikasi (jalur aman).
        }
      }
      await self.registration.showNotification(title, {
        body,
        icon: "/logo.png",
        badge: "/logo.png",
        tag: data.tag || "nexa",
        data: { url },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Prioritaskan tab yang terlihat; kalau tidak ada, tab mana pun.
      const visible = clientList.find((c) => c.visibilityState === "visible");
      const target = visible || clientList[0];
      if (target && "focus" in target) {
        return target.focus().then(() =>
          "navigate" in target ? target.navigate(url) : undefined
        );
      }
      return self.clients.openWindow(url);
    })
  );
});

import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/version";

/**
 * Manifest PWA (v1.21.0) — /manifest.webmanifest.
 *
 * Membuat toko installable (Android/desktop: "Pasang aplikasi"; iOS:Tambah
 * ke Layar Utama). Ini juga SYARAT notifikasi push di iOS 16.4+: Safari
 * hanya mengizinkan Web Push untuk web yang dipasang ke layar utama.
 * Service worker (/sw.js) sudah mendaftarkan handler push.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} — Top Up Game`,
    short_name: APP_NAME,
    description:
      "Top up game favorit di Nexa Store: pilih nominal, isi data akun, pesan langsung via WhatsApp. Lacak status pesanan real-time.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#1a1b1f",
    theme_color: "#1a1b1f",
    lang: "id",
    dir: "ltr",
    categories: ["shopping", "games"],
    icons: [
      {
        src: "/logo.png",
        sizes: "256x256",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}

# Nexa Store — Telegram Bot

Bot kendali privat untuk **Developer Nexa Store**. Semua tombol dan input
berjalan lewat chat Telegram; setiap aksi dieksekusi lewat API aplikasi
dengan sesi developer — validasi, deteksi konflik, dan persistensi GitHub
ikut berlaku, sama seperti mengoperasikan dashboard dari browser.

Bot: **@nexastoregamebot** · Service port: **3005** (health probe + WebSocket chat bridge).

Mode `BOT_HEADLESS=1` menjalankan bot tanpa server HTTP (polling Telegram,
scheduler, dan watcher tetap aktif) — berguna saat proses harus lolos dari
pembersihan sesi panel (listener TCP dibersihkan otomatis antar sesi).

## Dua runtime, satu bot (v1.4.0)

| | 🏠 Panel (default) | 🚀 Vercel (webhook) |
| --- | --- | --- |
| Cara hidup | long polling, layanan Bun | `POST /api/telegram/webhook` di serverless produksi |
| Ketahanan | hidup selama panel menyala; auto-revive via `src/instrumentation.ts` | aktif 24/7, tahan restart panel |
| Fitur | **lengkap**: tugas terjadwal, notifikasi chat instan, digest harian | interaktif penuh (semua menu & aksi) |

Berpindah: `/runtime` di chat → **“Pindah ke Vercel”** / **“Kembali ke panel”**.
Poller panel otomatis standby saat webhook aktif dan mengambil alih ≤60 dtk
begitu webhook dilepas — tidak pernah ada konflik 409.

Aktivasi runtime Vercel (sekali): set di Vercel env —
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (sama dengan .env bot),
`NEXA_API_BASE` (URL produksi), `NEXA_DEV_EMAIL`, `NEXA_DEV_PASSWORD` —
lalu redeploy dan jalankan `/runtime`. Pairing pemilik tersimpan permanen
di data store (`data/store/bot-state.json`, commit `ops:*` tanpa rebuild).

## Kemampuan

| Menu | Aksi |
| ---- | ---- |
| 🔒 Lockdown | Total, rute tertentu (`/`, `/games`, `/games/*`, `/help`), dengan alasan; angkat lockdown |
| 🛠 Perbaikan | Maintenance total / rute dengan pesan; akhiri perbaikan |
| 💬 Obrolan | Notifikasi pesan baru dari pengunjung (instan); daftar percakapan; balas & tandai dibaca — balasan tampil di widget chat storefront; 🔍 cari percakapan; 🗑 hapus satu / 🧹 hapus semua (v1.6.0) |
| 🏷 Promo | Buat event diskon (nama → persen → cakupan semua game / satu game → durasi); aktif/nonaktif promo |
| 📣 Banner | Terbitkan banner pengumuman 4 level dengan tombol CTA opsional + durasi; tampil/sembunyikan |
| 📊 Analitik | Pengunjung online, views hari ini/7 hari, halaman populer, sumber trafik, perangkat |
| ⏰ Tugas | Jadwalkan otomasi berwaktu: maintenance/lockdown ON/OFF, banner/promo ON/OFF, set announcement, pengingat Telegram |
| 👮 Admin | Blokir admin (dengan alasan, sesi langsung dicabut) / buka blokir |
| 📦 Katalog | Tambah game (ikon via foto di chat), kategori, produk; ubah harga; aktif/nonaktif game & produk |
| 🚀 Deployment | Deploy ulang commit terbaru, pilih commit mana pun dari daftar, atau deploy ulang dari deployment produksi lama (rollback) — progres build dipantau dan dilaporkan |
| ⚙️ Setelan | Ubah nomor WhatsApp & announcement; lihat template checkout |
| 📊 Status | Gate, katalog, analitik singkat, tugas menunggu, versi app, build terakhir |
| 📦 Lacak Pesanan | `/lacak_order <ID>` → kartu pesanan (item, total, riwayat, keterangan) + tombol status pending/proses/sukses/batal → kirim keterangan → pengunjung membacanya di /track (v1.6.0). Notifikasi pesanan baru tampil otomatis dengan tombol status |
| 🚩 Laporan | Laporan bug/saran pengguna dari /reports masuk ke chat pemilik lengkap waktu WIB, nama, tipe, dan lampiran media (v1.6.0) |
| 🔍 Debugging | `/debugging` — pemindai statis nyata atas kode situs: 13 aturan (rahasia tertanam, eval/new Function, XSS innerHTML, injeksi shell, log kredensial, ignoreBuildErrors, TODO) + pemeriksaan struktural route API mutasi tanpa guard. Sumber: disk lokal (panel) / GitHub API (Vercel). Laporan per-severity dengan file:baris + saran (v1.7.0) |

Otomatis di latar belakang: notifikasi obrolan baru (polling produksi 25 dtk),
eksekutor tugas terjadwal (cek 30 dtk), dan digest analitik harian 21:00 WIB.

## Menu perintah `/`

Ketik `/` di chat dan Telegram menampilkan seluruh perintah berdeskripsi
(terdaftar otomatis via `setMyCommands`):

`/menu` · `/status` · `/lockdown` · `/maintenance` · `/promo` · `/banner` ·
`/chat` · `/lacak_order` · `/debugging` · `/tasks` · `/analytics` · `/admin` ·
`/catalog` · `/deploy` · `/settings` · `/runtime` · `/cancel` · `/help`

(18 perintah)

Setiap perintah membuka menu yang sama dengan tombolnya — tidak ada fitur
yang hanya bisa dijangkau lewat satu jalur.

## Cara pakai (pertama kali)

1. Isi `.env` dari `.env.example` (token bot dari @BotFather, kredensial
   developer sama dengan `.env` aplikasi utama, token Vercel/GitHub).
2. Jalankan service (dari folder ini):
   ```bash
   bun run dev
   ```
3. Buka `t.me/nexastoregamebot` → `/start` → kirim **kode pairing** dari
   `.env` (`PAIRING_CODE`). Akun Telegram yang berhasil pairing menjadi
   satu-satunya pemilik — akun lain ditolak otomatis.
4. Setelah pairing, `.state.json` mencatat pemilik dan kode tidak dipakai lagi.

## Menjalankan di panel (sandbox)

- Saat panel boot, `.zscripts/dev.sh` otomatis menjalankan semua folder di
  `mini-services/` yang punya `package.json` + skrip `dev` — termasuk bot ini.
- Proses yang lahir dari sesi shell panel akan dibersihkan saat sesi berakhir;
  karena itu sediakan launcher di dalam aplikasi: **`POST /api/bot-service`**
  (aktif hanya bila `BOT_SERVICE_LAUNCH=1` di `.env`, 404 di produksi).
  Launcher memeriksa health `:3005` dulu — aman dipanggil berulang:
  ```bash
  curl -X POST http://localhost:3000/api/bot-service
  curl    http://localhost:3000/api/bot-service   # status
  ```

## Bridge chat instan (v1.5.0)

Aplikasi sandbox meneruskan pesan baru pengunjung ke bot **detik itu juga**
lewat `POST /internal/chat-notify` (dilindungi header `x-nexa-internal`):

- `.env` aplikasi: `BOT_SERVICE_INTERNAL_URL=http://127.0.0.1:3005` +
  `BOT_SERVICE_INTERNAL_SECRET=<rahasia>`.
- `.env` bot: `BOT_INTERNAL_SECRET=<rahasia yang sama>` — tanpa ini endpoint
  internal membalas 404.
- Payload menyertakan `lastMessageAt`; bot langsung `markNotified` supaya
  chat-watcher (poll 25 dtk) tidak mengirim ping ganda.
- Di Vercel (tanpa bot lokal) aplikasi mengirim notifikasi sendiri langsung ke
  Telegram Bot API — jalur ini hanya butuh `TELEGRAM_BOT_TOKEN` + pairing
  pemilik di data store `bot-state`.

## Arsitektur

```
Telegram ⇄ long polling ⇄ bot (Bun, :3005 health)
                             │
                             ├─ nexa.ts    → API aplikasi (login developer,
                             │              cookie HMAC, mutasi + kontrol akses)
                             ├─ vercel.ts  → Vercel API (daftar & buat deployment)
                             ├─ gitops.ts  → GitHub API (commit list, versi)
                             │              + git fetch/rebase (sinkron sandbox)
                             └─ state.ts   → pairing owner + sesi percakapan
```

- **Tidak ada tulis berkas langsung** — semua perubahan lewat endpoint
  manajemen aplikasi (`/api/management/*`, `/api/developer/*`) sehingga
  validasi Zod, integritas katalog, dan write-through GitHub tetap berjalan.
- Setelah tulis sukses, repo sandbox di-`fetch + rebase --autostash`
  supaya pratinjau panel sejajar dengan produksi (non-fatal bila gagal).
- Konflik revisi (409) diulang otomatis satu kali dengan data termutakhir.
- Sesi developer kedaluwarsa 8 jam — bot login ulang otomatis.

## Keamanan

- `.env` dan `.state.json` **selalu di-gitignore** — jangan pernah commit.
- Kode pairing dibatasi 5 percobaan salah per akun per jam.
- Hanya `ownerUserId` (hasil pairing) yang diproses; pesan lain ditolak.
- Token/password tidak pernah dicetak ke log maupun balasan chat.

## Catatan deployment

Bot berjalan di panel (Bun service) sebagai runtime default, dan **bisa
pindah ke Vercel** lewat `/runtime` (webhook, aktif 24/7 — lihat bagian
“Dua runtime” di atas). Endpoint health: `GET :3005/health`.
Bila bot dipindahkan ke mesin lain: salin folder ini, isi `.env`, jalankan
`bun run start`, lalu kirim ulang pairing (hapus `.state.json` bila ingin
klaim ulang pemilik).

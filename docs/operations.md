# Nexa Store — Operations Runbook (PRD §58)

Semua langkah di bawah telah diverifikasi di sesi ini kecuali yang ditandai MANUAL.

## Menjalankan lokal

```bash
bun install
bun scripts/seed-data.ts   # tulis data awal (aman, tidak menimpa tanpa --force)
bun run dev                # http://localhost:3000
```

## Konfigurasi env

Salin `.env.example` → `.env`. Wajib: `SESSION_SECRET` (64 hex), `AUTH_ADMIN_*`, `AUTH_DEVELOPER_*`. Opsional (mode GitHub): `GITHUB_OWNER/REPOSITORY/BRANCH/TOKEN`. Tanpa GITHUB_*, aplikasi berjalan mode lokal.

## Login

- Admin / Developer sesuai env. Ganti kredensial = ganti env, tanpa ubah kode.
- Rate limit: 5 percobaan gagal / 10 menit per IP+email → tunggu atau restart dev server (limiter in-memory).

## Cara kerja Git Sync

- Setiap sinkronisasi = satu commit (`store: …`). Mode lokal menulis snapshot ke `data/store/.history/` sebelum perubahan (maks. 40 snapshot).
- Pratinjau diff tersedia sebelum konfirmasi. Sukses dilaporkan hanya setelah penulisan terverifikasi.

## Pemulihan dari konflik (409)

1. Toast "Konflik data terdeteksi" muncul — draft Anda tetap ada.
2. Muat ulang data (refresh halaman) → data terbaru masuk.
3. Terapkan ulang perubahan draft → sinkronkan lagi.

## Menemukan commit terakhir yang sehat

- Developer → Git Sync → Riwayat (pesan commit + waktu WIB).
- Pratinjau restore menampilkan ringkasan perubahan bila data dikembalikan ke revisi tersebut.
- Restore = commit baru (validasi dijalankan dulu; revisi rusak ditolak otomatis).

## Mematikan mode perbaikan

Admin → Pengaturan Store → matikan "Mode perbaikan" → Simpan. Storefront langsung kembali normal.

## Verifikasi deployment

1. Push ke GitHub (cabang yang dikonfigurasi) → Vercel memicu build.
2. Buka dashboard Vercel → pastikan build sukses (log dibaca sampai selesai).
3. Buka URL produksi → footer + Diagnostics menampilkan versi; katalog memuat produk.
4. Developer → Deployment menampilkan referensi commit vs deployment. **Jangan klaim "production updated" sebelum URL produksi terverifikasi menayangkan commit yang dimaksud.**

MANUAL (belum diverifikasi di sandbox): build produksi Vercel, mutasi mode-GitHub langsung (butuh env + repositori asli).

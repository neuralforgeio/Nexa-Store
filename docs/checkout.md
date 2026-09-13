# Nexa Store — Checkout Flow (developer reference)

Dua jalur pemesanan tersedia sejak v1.0.0:

## Jalur 1 — Instant (satu produk)

```text
Pilih produk (tekan kartu "Pesan")
→ Drawer pesanan: ringkasan produk + harga
→ Field dinamis dari game.orderFieldSchema (label/tipe/wajib/pattern/min-max)
   + "Nama Anda" + "Catatan (opsional)"
→ Validasi (Zod per-game, error inline, nilai dipertahankan)
→ Pratinjau pesan live (template dirender ulang tiap ketikan)
→ [Pesan via WhatsApp]  → window.open(wa.me) ; bila diblokir → toast + salin otomatis
→ [Salin pesan]          → clipboard fallback
```

## Jalur 2 — Keranjang multi-item (`src/lib/cart/`, `src/components/store/cart/`)

```text
Tambah (tombol "Tambah" di kartu produk; maksimal 5 item)
→ Buka keranjang (ikon keranjang di navbar; badge jumlah item)
→ Review: status per-item (✓ Data lengkap / ⚠ Data belum diisi) + form inline
   (tiap item punya data akunnya sendiri, sesuai skema field game tsb)
→ Lanjut ke peninjauan (validasi semua item; item bermasalah difokuskan)
→ Snapshot immutable (referensi NEXA-YYMMDD-XXXX + total + data item)
→ Lanjut ke WhatsApp → SATU pesan terstruktur untuk seluruh keranjang
→ Cart dikosongkan + riwayat pesanan lokal tersimpan (maks. 10, bisa dihapus)
```

- Persistensi: `localStorage` (key `nexa-store-cart-v1`), di-sanitasi saat
  rehydrate (shape-check, cap 5 item, entri rusak dibuang).
- Harga SELALU diresolusi dari katalog terkini — harga di localStorage tidak
  dipercaya. Item yang produknya sudah tidak tersedia dihapus otomatis dengan
  notifikasi.
- Batas 5 item ditegakkan di store (data level), di UI (toast informatif),
  dan divalidasi ulang saat checkout.
- Format pesan multi-item: `src/lib/cart/message.ts` (terdokumentasi di
  fungsi `buildCartWhatsAppMessage`).

## Template engine (`src/lib/whatsapp/template.ts`)

- Placeholder allowlist: `{storeName} {gameName} {productName} {price} {customerName} {playerId} {serverId} {note} {orderDetails} {timestamp}`.
- `{orderDetails}` merender SEMUA field terkonfigurasi game sebagai "Label: nilai" (menyelesaikan ketegangan field-dinamis vs set-placeholder tetap — A9).
- Placeholder tak dikenal → gagal-tertutup (exception) — divalidasi juga saat simpan template lewat panel Checkout (Admin).
- Deterministik; pelestarian baris-baru; tanpa kebocoran `undefined`; angka Rupiah via `Intl` id-ID.
- Nomor tujuan dinormalisasi (`+62 888-6567-888` → `628886567888`) dan pesan di-URL-encode.

## Pesan default (seed)

```text
Halo {storeName}, saya ingin melakukan pemesanan.

Produk: {productName}
Game: {gameName}
Harga: {price}

Nama: {customerName}
{orderDetails}
Tanggal Pemesanan: {timestamp}

Catatan:
{note}
```

(Catatan: baris "Tanggal Pemesanan" ditambahkan melalui UI oleh pemilik store — bukan bagian seed awal; template dapat diubah Admin tanpa menyentuh kode.)

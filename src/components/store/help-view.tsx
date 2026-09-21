"use client";

import { motion, useReducedMotion } from "framer-motion";
import { RouteLink } from "@/components/shared/route-link";
import { Button } from "@/components/ui/button";
import { useCatalog } from "@/lib/queries";
import { Reveal } from "@/components/shared/reveal";
import { FaqLedger } from "./faq-ledger";
import { displayPhone } from "@/lib/format/phone";
import { formatIdr } from "@/lib/format/idr";
import { buildWhatsAppUrl } from "@/lib/whatsapp/url";
import { ArrowLeft, LifeBuoy, MessageCircle } from "lucide-react";

/** Help / FAQ — real answers only, derived from actual store configuration. */
export function HelpView() {
  const { data } = useCatalog();
  const reducedMotion = useReducedMotion();
  const store = data?.store;
  const minPrice = data && data.products.length > 0 ? Math.min(...data.products.map((p) => p.priceIdr)) : null;
  const maxPrice = data && data.products.length > 0 ? Math.max(...data.products.map((p) => p.priceIdr)) : null;

  const faqs: Array<{ q: string; a: string }> = [
    {
      q: "Bagaimana cara pesan?",
      a: "Buka game, pilih nominal, lalu tekan kartu produknya untuk pesan langsung. Isi data akun yang diminta, periksa ringkasan pesanan, lalu lanjut ke WhatsApp. Pesan pesanan tersusun otomatis.",
    },
    {
      q: "Bagaimana cara pakai keranjang?",
      a: "Tekan tombol Tambah pada kartu produk untuk memasukkannya ke keranjang. Keranjang menampung maksimal 5 item, dan setiap item punya kolom data akunnya sendiri — Valorant minta Riot ID, Mobile Legends minta User ID dan Zone ID, dan seterusnya. Saat selesai, buka keranjang di menu atas, lengkapi datanya, lalu semua pesanan terkirim dalam satu chat WhatsApp.",
    },
    {
      q: "Apakah perlu mendaftar akun?",
      a: "Tidak perlu. Pesanan dikirim langsung dari WhatsApp kamu.",
    },
    {
      q: "Harga di website sudah final?",
      a: "Ya. Harga yang tampil pada kartu produk sudah dikonfirmasi admin. Kalau ada perubahan, admin memberi tahu sebelum pembayaran.",
    },
    {
      q: "Data apa yang perlu diisi?",
      a: "Tergantung game: User ID, Riot ID, UID, atau Zone. Kolom yang perlu diisi muncul otomatis saat memesan.",
    },
    {
      q: "Bagaimana pembayarannya?",
      a: "Metode pembayaran dikonfirmasi admin lewat WhatsApp setelah pesanan diterima. Belum ada pembayaran otomatis di website ini.",
    },
    {
      q: "Berapa lama proses top up?",
      a: "Setelah pesan WhatsApp terkirim, admin mengonfirmasi ketersediaan dan pembayaran, lalu memproses top up. Kecepatan mengikuti jam operasional store.",
    },
    ...(minPrice !== null && maxPrice !== null && Number.isFinite(minPrice) && Number.isFinite(maxPrice)
      ? [
          {
            q: "Berapa rentang harga nominal?",
            a: `Nominal aktif saat ini berkisar ${formatIdr(minPrice)} sampai ${formatIdr(maxPrice)} tergantung game dan nominal yang dipilih.`,
          },
        ]
      : []),
  ];

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
      >
        <RouteLink
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          Beranda
        </RouteLink>

        <div className="mt-5 flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
            <LifeBuoy aria-hidden="true" className="h-6 w-6" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Bantuan</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Hal-hal yang paling sering ditanyakan seputar pemesanan di{" "}
              {store?.name ?? "store ini"}.
            </p>
          </div>
        </div>
      </motion.div>

      <Reveal delay={0.08} className="mt-8">
        <FaqLedger items={faqs} className="w-full" defaultKey="faq-0" />
      </Reveal>

      <Reveal delay={0.14} className="mt-10">
        <section
          aria-labelledby="help-contact"
          className="bg-atmosphere rounded-2xl border bg-card p-6 shadow-card"
        >
          <h2 id="help-contact" className="font-display text-lg font-semibold">
            Masih ada pertanyaan?
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Chat admin langsung di WhatsApp
            {store ? (
              <>
                {" "}
                <span className="font-mono text-foreground">{displayPhone(store.whatsappNumber)}</span>
              </>
            ) : null}
            .
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {store ? (
              <Button className="gap-2 bg-wa font-semibold text-wa-foreground hover:bg-wa/90" asChild>
                <a
                  href={buildWhatsAppUrl(store.whatsappNumber, "Halo, saya mau tanya soal top up game.")}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle aria-hidden="true" className="h-4 w-4" />
                  Chat WhatsApp
                </a>
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <RouteLink href="/games">Lihat katalog game</RouteLink>
            </Button>
          </div>
        </section>
      </Reveal>
    </main>
  );
}

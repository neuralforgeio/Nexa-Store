"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { RouteLink } from "@/components/shared/route-link";
import { Button } from "@/components/ui/button";
import { ProductCard } from "./product-card";
import { GameCard } from "./game-card";
import { EdgeFadeScroller } from "@/components/shared/edge-fade-scroller";
import { OrderSheet } from "./order-sheet";
import { Reveal } from "@/components/shared/reveal";
import { GameMark } from "@/components/shared/game-mark";
import { PriceTag } from "@/components/shared/price-tag";
import { LoadingState, EmptyState, ErrorState } from "@/components/shared/state-views";
import { FaqLedger } from "./faq-ledger";
import { useCatalog, type PublicCatalog } from "@/lib/queries";
import type { Product } from "@/lib/catalog/types";
import { buildWhatsAppUrl } from "@/lib/whatsapp/url";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  CheckCheck,
  Gamepad2,
  MessageCircle,
  SearchX,
  ShieldCheck,
  UserRoundX,
} from "lucide-react";
import { toast } from "sonner";

type OrderTarget = { product: Product; game: PublicCatalog["games"][number] } | null;

const HOW_STEPS = [
  {
    title: "Pilih nominal",
    body: "Tekan kartu produk untuk pesan langsung, atau tekan Tambah untuk mengumpulkan beberapa produk sekaligus.",
  },
  {
    title: "Isi data akun",
    body: "Masukkan User ID atau data lain yang diminta. Setiap item di keranjang punya data akunnya sendiri.",
  },
  {
    title: "Kirim via WhatsApp",
    body: "Pesan pesanan tersusun otomatis dalam satu chat. Tinggal kirim, admin akan konfirmasi pembayaran.",
  },
] as const;

const WHY_ITEMS = [
  {
    Icon: Banknote,
    title: "Harga tampil, harga akhir",
    body: "Tidak ada biaya tambahan di tengah proses. Yang tampil di kartu produk itulah yang dibayar.",
  },
  {
    Icon: UserRoundX,
    title: "Tanpa registrasi",
    body: "Tidak perlu bikin akun. Pesanan dikirim langsung dari WhatsApp kamu.",
  },
  {
    Icon: BadgeCheck,
    title: "Dikonfirmasi admin",
    body: "Setiap pesanan dicek manual oleh admin sebelum diproses, bukan oleh bot.",
  },
  {
    Icon: ShieldCheck,
    title: "Data akun dipakai seperlunya",
    body: "Data akun hanya dipakai untuk memproses pesanan kamu, tidak untuk lainnya.",
  },
] as const;

const FAQ_ITEMS = [
  {
    q: "Bisa pesan beberapa produk sekaligus?",
    a: "Bisa. Tekan Tambah pada produk yang diinginkan — keranjang menampung maksimal 5 item, dan semua pesanan terkirim dalam satu chat WhatsApp.",
  },
  {
    q: "Apakah harus daftar akun dulu?",
    a: "Tidak. Pilih nominal, isi data akun game, lalu kirim pesanan lewat WhatsApp.",
  },
  {
    q: "Harga di halaman sudah final?",
    a: "Ya. Harga yang tampil sudah dikonfirmasi admin. Kalau ada perubahan, admin memberi tahu sebelum pembayaran.",
  },
  {
    q: "Data apa yang perlu disiapkan?",
    a: "Tergantung game: User ID, Riot ID, atau UID. Kolom yang perlu diisi muncul otomatis saat memesan.",
  },
  {
    q: "Berapa lama pesanan diproses?",
    a: "Setelah pesan WhatsApp terkirim, admin konfirmasi ketersediaan dan pembayaran, lalu top up diproses. Proses mengikuti jam operasional store.",
  },
  {
    q: "Bagaimana pembayarannya?",
    a: "Metode pembayaran dikonfirmasi admin lewat WhatsApp setelah pesanan kamu terkirim.",
  },
] as const;

export function HomeView() {
  const { data, isPending, isError, refetch } = useCatalog();
  const reducedMotion = useReducedMotion();
  const [orderTarget, setOrderTarget] = useState<OrderTarget>(null);

  const derived = useMemo(() => {
    if (!data) return null;
    const games = [...data.games].sort((a, b) => a.sortOrder - b.sortOrder);
    const byGame = new Map(games.map((g) => [g.id, g]));
    const productsByGame = new Map<string, Product[]>();
    for (const p of data.products) {
      const list = productsByGame.get(p.gameId) ?? [];
      list.push(p);
      productsByGame.set(p.gameId, list);
    }
    for (const list of productsByGame.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);

    // Admin-curated selection: one mid-tier nominal per game, storefront order.
    const featured: Array<{ product: Product; game: PublicCatalog["games"][number] }> = [];
    for (const game of games) {
      const list = productsByGame.get(game.id) ?? [];
      if (list.length === 0) continue;
      const pick = list[Math.min(2, list.length - 1)];
      featured.push({ product: pick, game });
      if (featured.length >= 8) break;
    }

    const floatPicks = featured.slice(0, 3);
    return { games, featured, floatPicks, totalNominal: data.products.length };
  }, [data]);

  if (isPending) {
    return (
      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-20 pt-12 sm:px-6">
        <LoadingState label="Memuat katalog…" className="min-h-[60vh]" />
      </main>
    );
  }

  if (isError || !data || !derived) {
    return (
      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-20 pt-12 sm:px-6">
        <ErrorState
          title="Katalog tidak dapat dimuat"
          description="Periksa koneksi kamu, lalu coba lagi."
          className="min-h-[60vh]"
          action={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Coba lagi
            </Button>
          }
        />
      </main>
    );
  }

  const { store } = data;
  const maintenance = store.maintenanceMode;
  // One real product carries the whole how-it-works story (Fig. 01 → 03).
  const demo = derived.featured[0] ?? null;

  return (
    <main id="main">
      {store.announcement ? (
        <div
          role="note"
          className="border-b border-primary/20 bg-primary/10 px-4 py-2 text-center text-sm text-primary sm:px-6"
        >
          {store.announcement}
        </div>
      ) : null}

      {maintenance ? (
        <div
          role="alert"
          className="border-b border-destructive/25 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive sm:px-6"
        >
          {store.maintenanceMessage || "Store sedang dalam perbaikan. Pemesanan sementara ditutup."}
        </div>
      ) : null}

      {/* Hero — compact, products stay one scroll away. */}
      <section
        aria-labelledby="hero-heading"
        className="bg-atmosphere relative overflow-hidden border-b border-border/60"
      >
        <div aria-hidden="true" className="bg-grid absolute inset-0 [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)]" />
        <div className="relative mx-auto grid w-full max-w-6xl gap-8 px-4 pb-12 pt-10 sm:px-6 sm:pb-16 sm:pt-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <motion.p
              initial={reducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
            >
              <span aria-hidden="true" className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              Store aktif
            </motion.p>

            <motion.h1
              id="hero-heading"
              initial={reducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05, ease: "easeOut" }}
              className="font-display text-balance text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl"
            >
              Top up game, langsung lewat{" "}
              <span className="text-primary">WhatsApp</span>.
            </motion.h1>

            <motion.p
              initial={reducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1, ease: "easeOut" }}
              className="mt-4 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base"
            >
              Pilih game, pilih nominal, kirim pesanan. Harga yang tampil
              adalah harga akhir.
            </motion.p>

            <motion.div
              initial={reducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15, ease: "easeOut" }}
              className="mt-6 flex flex-wrap items-center gap-3"
            >
              <Button size="lg" className="gap-2 font-semibold" asChild>
                <RouteLink href="/games">
                  <Gamepad2 aria-hidden="true" className="h-4 w-4" />
                  Lihat game
                </RouteLink>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#cara-pesan">Cara pesan</a>
              </Button>
            </motion.div>

            <motion.dl
              initial={reducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.25 }}
              className="mt-8 flex flex-wrap gap-x-8 gap-y-3"
            >
              <div className="flex items-baseline gap-2">
                <dt className="sr-only">Jumlah game</dt>
                <dd className="font-display text-2xl font-bold tabular">{derived.games.length}</dd>
                <dd className="text-xs text-muted-foreground">game tersedia</dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="sr-only">Jumlah nominal</dt>
                <dd className="font-display text-2xl font-bold tabular">{derived.totalNominal}</dd>
                <dd className="text-xs text-muted-foreground">pilihan nominal</dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="sr-only">Metode pemesanan</dt>
                <dd className="font-display text-2xl font-bold">1</dd>
                <dd className="text-xs text-muted-foreground">chat WhatsApp</dd>
              </div>
            </motion.dl>
          </div>

          {/* Floating real products — desktop only, gentle drift. */}
          <div aria-hidden="true" className="relative hidden min-h-72 lg:block">
            {derived.floatPicks.map(({ product, game }, i) => {
              const spots = [
                { left: "6%", top: "4%", depth: 1 },
                { left: "52%", top: "38%", depth: 2 },
                { left: "16%", top: "62%", depth: 3 },
              ];
              const spot = spots[i % spots.length];
              return (
                <motion.div
                  key={product.id}
                  initial={reducedMotion ? false : { opacity: 0, y: 16, scale: 0.96 }}
                  animate={{ opacity: 1, y: [0, -8, 0], scale: 1 }}
                  transition={{
                    opacity: { duration: 0.4, delay: 0.2 + i * 0.12 },
                    scale: { duration: 0.3, delay: 0.2 + i * 0.12 },
                    y: reducedMotion
                      ? { duration: 0 }
                      : { duration: 5 + i * 0.8, repeat: Infinity, ease: "easeInOut", delay: i * 0.6 },
                  }}
                  style={{ position: "absolute", left: spot.left, top: spot.top, zIndex: 4 - spot.depth }}
                  className="w-60 rounded-xl border bg-card/95 p-4 shadow-card backdrop-blur"
                >
                  <div className="flex items-center gap-2.5">
                    <GameMark name={game.name} image={game.image} size="sm" />
                    <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {game.name}
                    </span>
                  </div>
                  <p className="mt-2.5 font-display text-lg font-semibold leading-tight">
                    {product.denomination} {product.name}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <PriceTag value={product.priceIdr} size="md" />
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      tersedia
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        {/* Featured games */}
        <section aria-labelledby="featured-heading" className="py-10 sm:py-12">
          <SectionHeader
            id="featured-heading"
            kicker="Game"
            title="Pilihan game"
            action={
              <Button variant="ghost" size="sm" className="gap-1.5 text-primary" asChild>
                <RouteLink href="/games">
                  Semua game
                  <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                </RouteLink>
              </Button>
            }
          />
          {derived.games.length === 0 ? (
            <EmptyState className="mt-5" title="Belum ada game" description="Game yang tersedia akan muncul di sini." />
          ) : (
            <EdgeFadeScroller
              ariaLabel="Pilihan game"
              className="-mx-4 mt-5 px-4 sm:mx-0 sm:px-0"
            >
              {derived.games.map((game, i) => (
                <div role="listitem" key={game.id} className="h-full">
                  <GameCard game={game} variant="tile" index={i} />
                </div>
              ))}
            </EdgeFadeScroller>
          )}
        </section>

        {/* Curated denominations */}
        <section aria-labelledby="picks-heading" className="section-line py-10 sm:py-12">
          <SectionHeader
            id="picks-heading"
            kicker="Nominal"
            title="Pilihan nominal"
            action={
              <Button variant="ghost" size="sm" className="gap-1.5 text-primary" asChild>
                <RouteLink href="/games">
                  Lihat semua
                  <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                </RouteLink>
              </Button>
            }
          />
          <p className="mt-2 font-mono text-[11px] tracking-wide text-muted-foreground">
            Satu nominal pilihan per game — harga yang tampil adalah harga yang dibayar.
          </p>
          {derived.featured.length === 0 ? (
            <EmptyState className="mt-5" title="Belum ada produk" description="Produk yang tersedia akan muncul di sini." />
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {derived.featured.slice(0, 8).map(({ product, game }, i) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  gameId={game.id}
                  index={i}
                  gameName={game.name}
                  gameImage={game.image}
                  showGame
                  disabled={maintenance}
                  onOrder={(p) => {
                    if (maintenance) {
                      toast.info("Pemesanan sedang ditutup", {
                        description: store.maintenanceMessage || "Store dalam mode perbaikan.",
                      });
                      return;
                    }
                    setOrderTarget({ product: p, game });
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {/* How ordering works — an order rail with live specimens, not card boxes. */}
        <section id="cara-pesan" aria-labelledby="how-heading" className="section-line scroll-mt-24 py-10 sm:py-12">
          <SectionHeader id="how-heading" kicker="Cara pesan" title="Tiga langkah, selesai." />
          <ol className="mt-8 grid gap-10 md:mt-10 md:grid-cols-3 md:gap-8 lg:gap-10">
            {HOW_STEPS.map((item, i) => (
              <motion.li
                key={item.title}
                initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                whileInView={reducedMotion ? undefined : { opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.3, delay: i * 0.08, ease: "easeOut" }}
                className="relative pl-7 md:pl-0"
              >
                {/* Mobile rail — a vertical hairline threading the nodes. */}
                {i < HOW_STEPS.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-[-2.5rem] left-[5px] top-3 w-px bg-border md:hidden"
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-[8px] h-[11px] w-[11px] rounded-full border-2 border-primary bg-background md:hidden"
                />
                {/* Desktop rail — each column's hairline draws itself in sequence. */}
                <span aria-hidden="true" className="relative mb-6 hidden h-px w-full bg-border md:block">
                  {reducedMotion ? (
                    <span className="absolute inset-0 bg-primary/70" />
                  ) : (
                    <motion.span
                      initial={{ scaleX: 0 }}
                      whileInView={{ scaleX: 1 }}
                      viewport={{ once: true, margin: "-60px" }}
                      transition={{ duration: 0.55, delay: 0.1 + i * 0.28, ease: [0.65, 0, 0.35, 1] }}
                      className="absolute inset-0 origin-left bg-primary/70"
                    />
                  )}
                  <span className="absolute -top-[5px] left-0 h-[11px] w-[11px] rounded-full border-2 border-primary bg-background" />
                </span>
                <div className="flex items-baseline gap-2.5">
                  <span aria-hidden="true" className="font-mono text-[11px] font-semibold tabular text-primary">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="font-display text-base font-semibold">{item.title}</h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                <StepArtifact index={i} demo={demo} />
              </motion.li>
            ))}
          </ol>
        </section>

        {/* Trust — a guarantee manifest: sticky intro on the left, ledger on the right. */}
        <section aria-labelledby="why-heading" className="section-line py-10 sm:py-12 lg:py-14">
          <div className="grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <Reveal>
                <SectionHeader id="why-heading" kicker="Kenapa Nexa" title="Pesan tanpa drama." />
                <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Empat kepastian yang dipegang di setiap pesanan — bukan sekadar tulisan
                  di halaman depan. Kalau ada yang tidak sesuai, kirim laporan; admin
                  membacanya satu per satu.
                </p>
                <div className="mt-5">
                  <Button variant="ghost" size="sm" className="-ml-2.5 gap-1.5 text-primary" asChild>
                    <RouteLink href="/reports">
                      Kirim laporan
                      <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                    </RouteLink>
                  </Button>
                </div>
              </Reveal>
            </div>
            <div>
              <ul>
                {WHY_ITEMS.map(({ Icon, title, body }, i) => (
                  <motion.li
                    key={title}
                    initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                    whileInView={reducedMotion ? undefined : { opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-32px" }}
                    transition={{ duration: 0.3, delay: i * 0.06, ease: "easeOut" }}
                    className="group grid grid-cols-[2rem_1fr] gap-x-4 border-b border-border py-5 transition-colors hover:bg-accent/40 sm:-mx-4 sm:grid-cols-[2.5rem_minmax(0,13rem)_1fr] sm:gap-x-6 sm:px-4 sm:py-6"
                  >
                    <span
                      aria-hidden="true"
                      className="font-mono text-xs tabular text-muted-foreground/80 transition-colors group-hover:text-primary"
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="flex items-start gap-2.5">
                      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <h3 className="font-display text-sm font-semibold leading-snug">{title}</h3>
                    </div>
                    <p className="col-start-2 row-start-2 mt-2 text-sm leading-relaxed text-muted-foreground sm:col-start-3 sm:row-start-1 sm:mt-0">
                      {body}
                    </p>
                  </motion.li>
                ))}
              </ul>
              <Reveal delay={0.1}>
                <div className="flex items-baseline gap-3 pt-5 sm:-mx-4 sm:px-4">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Total biaya tersembunyi
                  </span>
                  <span aria-hidden="true" className="mb-1 flex-1 border-b border-dotted border-border" />
                  <PriceTag value={0} size="sm" className="font-semibold text-primary" />
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* FAQ — a numbered ledger; a direct line to a human sits in the header,
            not in a boxed card afterthought. */}
        <section id="faq" aria-labelledby="faq-heading" className="section-line scroll-mt-24 py-10 sm:py-12">
          <Reveal>
            <SectionHeader
              id="faq-heading"
              kicker="FAQ"
              title="Pertanyaan yang sering muncul."
              action={
                store ? (
                  <a
                    href={buildWhatsAppUrl(store.whatsappNumber, "Halo, saya mau tanya soal top up game.")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group mb-0.5 inline-flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <MessageCircle aria-hidden="true" className="h-3.5 w-3.5 text-wa" />
                    <span className="hidden sm:inline">belum ketemu jawabannya?</span>
                    <span className="sm:hidden">tanya admin</span>
                    <ArrowRight
                      aria-hidden="true"
                      className="h-3.5 w-3.5 text-primary transition-transform duration-200 group-hover:translate-x-0.5"
                    />
                  </a>
                ) : undefined
              }
            />
          </Reveal>
          <Reveal delay={0.08}>
            <FaqLedger items={FAQ_ITEMS} className="mt-6" />
          </Reveal>
        </section>

        {/* Final CTA */}
        <section aria-labelledby="cta-heading" className="pb-14 pt-2 sm:pb-16">
          <Reveal y={24}>
            <div className="bg-atmosphere relative overflow-hidden rounded-2xl border bg-card p-6 shadow-card sm:p-10">
              <div aria-hidden="true" className="bg-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(60%_80%_at_80%_20%,black,transparent)]" />
              <div className="relative flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 id="cta-heading" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
                    Siap top up sekarang?
                  </h2>
                  <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                    Pilih game, kirim pesanan, admin proses. Semua lewat satu chat WhatsApp.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button size="lg" className="gap-2 font-semibold" asChild>
                    <RouteLink href="/games">
                      Lihat semua game
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </RouteLink>
                  </Button>
                  <Button size="lg" variant="outline" className="gap-2" asChild>
                    <a
                      href={buildWhatsAppUrl(store.whatsappNumber, "Halo, saya mau tanya soal top up game.")}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle aria-hidden="true" className="h-4 w-4" />
                      Chat store
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {store.supportNote ? (
          <section aria-labelledby="support-heading" className="pb-14">
            <h2 id="support-heading" className="sr-only">
              Catatan pemesanan
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{store.supportNote}</p>
          </section>
        ) : null}
      </div>

      <OrderSheet
        product={orderTarget?.product ?? null}
        game={orderTarget?.game ?? null}
        store={store}
        template={data.checkoutTemplate}
        open={orderTarget !== null}
        onOpenChange={(open) => {
          if (!open) setOrderTarget(null);
        }}
      />

      <span className="hidden" data-view="home" aria-hidden="true" />
    </main>
  );
}

/**
 * Dashed "spec sheet" specimen — a miniature of the real UI rather than an
 * abstract icon. Purely illustrative, hidden from assistive tech.
 */
function Specimen({
  figure,
  caption,
  children,
}: {
  figure: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div aria-hidden="true" className="mt-5 rounded-lg border border-dashed border-border bg-muted/25 p-3.5">
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Fig. {figure} · {caption}
        </span>
        <span className="h-px flex-1 bg-border/80" />
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/**
 * The artifact under each how-it-works step. All three figures tell one
 * continuous story about the same product: it is picked, its account data is
 * filled in, and the order is sent as one WhatsApp chat.
 */
function StepArtifact({ index, demo }: { index: number; demo: OrderTarget }) {
  if (index === 0) {
    return (
      <Specimen figure="01" caption="Kartu produk">
        <div className="flex items-center gap-3">
          {demo ? (
            <GameMark name={demo.game.name} image={demo.game.image} className="h-8 w-8 rounded-md text-[10px]" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[13px] font-semibold leading-tight">
              {demo ? `${demo.product.denomination} ${demo.product.name}` : "Nominal pilihan"}
            </p>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {demo ? demo.game.name : "Nama game"}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {demo ? (
              <PriceTag value={demo.product.priceIdr} size="sm" className="text-xs" />
            ) : (
              <span className="font-mono text-xs tabular text-foreground">Rp —</span>
            )}
            <p className="mt-1 flex items-center justify-end gap-1 text-[10px] font-medium text-primary">
              <Check className="h-3 w-3" />
              tersedia
            </p>
          </div>
        </div>
      </Specimen>
    );
  }

  if (index === 1) {
    return (
      <Specimen figure="02" caption="Form isian">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          User ID
        </p>
        <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2">
          <span className="font-mono text-[12.5px] tabular text-foreground">12345678</span>
          <span className="caret h-3.5 w-[2px] rounded-full bg-primary" />
          <span className="ml-auto font-mono text-[10px] tabular text-muted-foreground">Server 2142</span>
        </div>
      </Specimen>
    );
  }

  return (
    <Specimen figure="03" caption="Chat WhatsApp">
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-tr-md border border-wa/25 bg-wa/10 px-3.5 py-2.5">
          <p className="font-mono text-[11.5px] leading-relaxed text-foreground">
            {demo ? `1× ${demo.product.denomination} ${demo.product.name}` : "1× Nominal pilihan"}
            <br />
            User ID 12345678
          </p>
          <p className="mt-1.5 flex items-center justify-end gap-1.5">
            {demo ? (
              <PriceTag value={demo.product.priceIdr} size="sm" className="text-[11px] font-medium text-wa" />
            ) : null}
            <CheckCheck className="h-3.5 w-3.5 text-wa" />
          </p>
        </div>
      </div>
    </Specimen>
  );
}

function SectionHeader({
  id,
  kicker,
  title,
  action,
}: {
  id: string;
  kicker: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">{kicker}</p>
        <h2 id={id} className="font-display mt-1.5 text-xl font-bold tracking-tight sm:text-2xl">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

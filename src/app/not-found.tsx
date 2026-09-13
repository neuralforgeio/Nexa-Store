import Link from "next/link";

/** Branded 404 for paths outside the SPA route map. */
export default function NotFound() {
  return (
    <main className="bg-background flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-display text-6xl font-bold tracking-tight text-primary/25">404</p>
      <h1 className="font-display text-xl font-semibold">Halaman tidak ditemukan</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Alamat yang kamu buka tidak ada atau sudah dipindahkan.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        Kembali ke beranda
      </Link>
    </main>
  );
}

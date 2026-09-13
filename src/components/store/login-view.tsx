"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RouteLink } from "@/components/shared/route-link";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { api, ApiError } from "@/lib/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Role } from "@/lib/catalog/types";
import { ArrowLeft, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

/**
 * Management login (hidden route: /login is deliberately unlinked, D7).
 * Standalone page: no storefront header or footer.
 */
export function LoginView({ onAuthenticated }: { onAuthenticated: (role: Role) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const reducedMotion = useReducedMotion();

  const login = useMutation({
    mutationFn: () => api.post<{ role: Role; email: string }>("/api/auth/login", { email, password }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["session"] });
      toast.success("Berhasil masuk", {
        description: `Mode ${data.role === "DEVELOPER" ? "Developer" : "Admin"}.`,
      });
      onAuthenticated(data.role);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Tidak dapat masuk saat ini. Coba lagi.");
      }
    },
  });

  return (
    <main id="main" className="grid min-h-dvh grid-cols-1 lg:grid-cols-2">
      {/* Brand panel */}
      <section
        aria-hidden="true"
        className="bg-atmosphere relative hidden flex-col justify-between overflow-hidden border-r border-border/70 p-10 lg:flex"
      >
        <div aria-hidden="true" className="bg-grid absolute inset-0 opacity-70 [mask-image:radial-gradient(75%_75%_at_30%_25%,black,transparent)]" />

        <div className="relative flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-primary to-primary/80 font-display text-base font-bold text-primary-foreground shadow-[var(--glow-primary)]">
            N
          </span>
          <span className="font-display text-base font-semibold uppercase tracking-tight">Nexa Store</span>
        </div>

        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="relative"
        >
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-card">
            <LockKeyhole className="h-7 w-7" />
          </div>
          <p className="font-display text-balance text-3xl font-bold leading-tight tracking-tight">
            Panel kelola katalog dan pengaturan store.
          </p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Harga, game, dan template pesanan dikelola dari satu tempat.
            Setiap perubahan tercatat dan bisa ditinjau ulang.
          </p>

          <ul className="mt-8 space-y-3">
            {[
              "Perubahan katalog tersimpan sebagai riwayat",
              "Harga dan nominal diedit langsung dari panel",
              "Template pesanan WhatsApp bisa disesuaikan",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-foreground/80">
                <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {item}
              </li>
            ))}
          </ul>
        </motion.div>

        <p className="relative flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
          Sesi terlindungi cookie bertanda tangan server.
        </p>
      </section>

      {/* Form panel */}
      <section className="relative flex items-center justify-center p-6 sm:p-10">
        <div className="absolute right-5 top-5">
          <ThemeToggle />
        </div>

        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="w-full max-w-sm"
        >
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-primary to-primary/80 font-display text-base font-bold text-primary-foreground shadow-[var(--glow-primary)]">
              N
            </span>
            <span className="font-display text-base font-semibold uppercase tracking-tight">Nexa Store</span>
          </div>

          <h1 className="font-display text-2xl font-bold tracking-tight">Masuk ke dashboard</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Halaman ini untuk Admin dan Developer store.
          </p>

          <form
            className="mt-8 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              login.mutate();
            }}
            noValidate
          >
            <div className="space-y-1.5">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="nama@store.id"
                className="h-11"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "login-error" : undefined}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-password">Password</Label>
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Password akun dashboard"
                  className="h-11 pr-11"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "login-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Sembunyikan password" : "Lihat password"}
                  aria-pressed={showPassword}
                  className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {showPassword ? (
                    <EyeOff aria-hidden="true" className="h-4 w-4" />
                  ) : (
                    <Eye aria-hidden="true" className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p aria-hidden="true" className="text-[11px] text-muted-foreground/60">
                Cek kembali password sebelum masuk — mata di kanan kolom membantu lihat typo.
              </p>
            </div>

            {error ? (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                role="alert"
                id="login-error"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              >
                {error}
              </motion.p>
            ) : null}

            <Button type="submit" size="lg" className="w-full font-semibold" disabled={login.isPending}>
              {login.isPending ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Masuk
            </Button>
          </form>

          <RouteLink
            href="/"
            className="mt-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
            Kembali ke store
          </RouteLink>
        </motion.div>
      </section>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useAppRoute, type AdminSection, type DeveloperSection } from "@/lib/router";
import { useSession, useCatalog } from "@/lib/queries";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
import { HomeView } from "./home-view";
import { GamesView } from "./games-view";
import { GameDetailView } from "./game-detail-view";
import { HelpView } from "./help-view";
import { LoginView } from "./login-view";
import { LoadingState, ErrorState } from "@/components/shared/state-views";
import { RouteLink } from "@/components/shared/route-link";
import { BlockedAdminDialog } from "@/components/shared/blocked-admin-dialog";
import { CartProvider } from "@/components/store/cart/cart-ui-context";
import { ManagementShell } from "@/components/admin/management-shell";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { AdminGames } from "@/components/admin/admin-games";
import { AdminCategories } from "@/components/admin/admin-categories";
import { AdminProducts } from "@/components/admin/admin-products";
import { AdminSettings } from "@/components/admin/admin-settings";
import { AdminCheckout } from "@/components/admin/admin-checkout";
import { DevDashboard } from "@/components/developer/dev-dashboard";
import { DevAccess } from "@/components/developer/dev-access";
import { DevControl } from "@/components/developer/dev-control";
import { DevGit } from "@/components/developer/dev-git";
import { DevData } from "@/components/developer/dev-data";
import { DevDiagnostics } from "@/components/developer/dev-diagnostics";
import { DevDeployment } from "@/components/developer/dev-deployment";
import { Button } from "@/components/ui/button";

export function NexaApp() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AppFrame />
    </QueryClientProvider>
  );
}

function AppFrame() {
  const [route, navigate] = useAppRoute();
  const reducedMotion = useReducedMotion();
  const isManagement = route.view === "admin" || route.view === "developer";
  // Poll the session inside the dashboard so a mid-session Admin block (D8)
  // surfaces as the blocking modal instead of a silent logout.
  const session = useSession(isManagement ? 20_000 : false);
  const [blockedDismissed, setBlockedDismissed] = useState(false);
  const [stickyBlock, setStickyBlock] = useState<{ reason: string | null } | null>(null);

  // The session endpoint clears the revoked cookie in the same response that
  // reports the block — the next poll then arrives WITHOUT the block info.
  // Hold the last-seen block so the modal stays until dismissed (rAF keeps
  // this off the effect body, per the React hooks lint rule).
  useEffect(() => {
    const info = session.data?.blocked;
    if (!info) return;
    const raf = requestAnimationFrame(() => setStickyBlock(info));
    return () => cancelAnimationFrame(raf);
  }, [session.data?.blocked]);

  const blocked = !blockedDismissed ? (stickyBlock ?? session.data?.blocked ?? null) : null;

  const isPublic =
    route.view === "home" || route.view === "games" || route.view === "game" || route.view === "help";

  // Scroll to top on view change.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.view, route.view === "game" ? route.slug : null]);

  // Guard management routes once the session is resolved.
  useEffect(() => {
    if (session.isPending || route.view === "login" || !isManagement) return;
    if (!session.data?.authenticated) {
      // Blocked Admins stay put — the blocking modal takes over the screen.
      if (stickyBlock || session.data?.blocked) return;
      navigate("/login");
    }
  }, [session.isPending, session.data, stickyBlock, route.view, isManagement, navigate]);

  // Redirect authenticated users away from the login view (effect, not render).
  useEffect(() => {
    if (route.view === "login" && session.data?.authenticated) {
      navigate(session.data.role === "DEVELOPER" ? "/dev" : "/admin", { replace: true });
    }
  }, [route.view, session.data, navigate]);

  // Site-gate watcher: the server gates hard navigations (see app/page.tsx);
  // this keeps soft, client-side navigations honest too — if the current
  // route becomes locked down or under maintenance, swap to the gate screen.
  const pathKey = route.view === "game" ? `game:${route.slug}` : route.view;
  useEffect(() => {
    if (isManagement || route.view === "login" || route.view === "not-found") return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(
          `/api/store-status?path=${encodeURIComponent(window.location.pathname)}`
        );
        const json = (await res.json()) as {
          ok: boolean;
          data?: {
            lockdown: { applies: boolean };
            maintenance: { applies: boolean };
          };
        };
        if (cancelled || !json.ok || !json.data) return;
        if (json.data.lockdown.applies) {
          window.location.replace("/lockdown");
        } else if (json.data.maintenance.applies) {
          window.location.replace("/maintenance");
        }
      } catch {
        // Network hiccup — the next interval re-checks.
      }
    };
    check();
    const timer = window.setInterval(check, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pathKey, isManagement, route.view]);

  const viewTransition = reducedMotion
    ? { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -4 },
      };

  const viewKey =
    route.view === "game"
      ? `game:${route.slug}`
      : route.view === "admin"
        ? `admin:${route.section}`
        : route.view === "developer"
          ? `dev:${route.section}`
          : route.view;

  const content = useMemo(() => {
    if (session.isPending && isManagement) {
      return <LoadingState label="Memeriksa sesi…" className="min-h-[60vh]" />;
    }

    if (route.view === "login") {
      return (
        <LoginView
          onAuthenticated={(role) => navigate(role === "DEVELOPER" ? "/dev" : "/admin")}
        />
      );
    }

    if (route.view === "home") return <HomeView />;
    if (route.view === "games") return <GamesView />;
    if (route.view === "game") return <GameDetailView slug={route.slug} />;
    if (route.view === "help") return <HelpView />;

    if (route.view === "not-found") {
      return <NotFoundView />;
    }

    const role = session.data?.role;
    if (isManagement && (!role || (role !== "ADMIN" && role !== "DEVELOPER"))) {
      return (
        <ErrorState
          title="Masuk diperlukan"
          description="Area ini hanya untuk Admin dan Developer."
          className="min-h-[60vh]"
          action={
            <Button size="sm" onClick={() => navigate("/login")}>
              Ke halaman masuk
            </Button>
          }
        />
      );
    }

    if (route.view === "admin" && (role === "ADMIN" || role === "DEVELOPER")) {
      return (
        <ManagementShell role={role} active={{ group: "admin", key: route.section }} onNavigate={navigate}>
          <AdminSectionView section={route.section} role={role} onNavigate={navigate} />
        </ManagementShell>
      );
    }

    if (route.view === "developer") {
      if (role !== "DEVELOPER") {
        // Stealth: staff surfaces beyond an Admin's own panel look exactly
        // like any other unknown address — no hint that another mode exists
        // (source-of-truth: the server still enforces every capability).
        return <NotFoundView />;
      }
      return (
        <ManagementShell role={role} active={{ group: "developer", key: route.section }} onNavigate={navigate}>
          <DeveloperSectionView section={route.section} onNavigate={navigate} />
        </ManagementShell>
      );
    }

    return null;
  }, [route, session.data, session.isPending, navigate, isManagement]);

  // Revoked Admin: a dark stage with the blocking modal dead center. Placed
  // after all hooks so the hook order stays stable across renders.
  if (blocked) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[oklch(0.165_0.015_25)] px-4">
        <span
          aria-hidden="true"
          className="mb-8 flex h-10 w-10 items-center justify-center rounded-xl border border-[oklch(0.45_0.16_25_/_0.4)] bg-[oklch(0.22_0.04_25)] font-display text-lg font-bold text-[oklch(0.55_0.14_25)]"
        >
          N
        </span>
        <BlockedAdminDialog
          open
          onOpenChange={(open) => {
            if (open) return;
            setBlockedDismissed(true);
            navigate("/login", { replace: true });
          }}
          reason={blocked.reason}
        />
      </div>
    );
  }

  // Login and dashboards are standalone: no storefront header/footer.
  if (route.view === "login" || isManagement) {
    return (
      <div className="flex min-h-dvh flex-col">
        <AnimatePresence mode="wait">
          <motion.div key={viewKey} {...viewTransition} transition={{ duration: 0.16, ease: "easeOut" }} className="contents">
            {content}
          </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  return (
    <CartProvider>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <AnimatePresence mode="wait">
          <motion.div key={viewKey} {...viewTransition} transition={{ duration: 0.16, ease: "easeOut" }} className="contents">
            {content}
          </motion.div>
        </AnimatePresence>
        <SiteFooter />
      </div>
    </CartProvider>
  );
}

function AdminSectionView({
  section,
  role,
  onNavigate,
}: {
  section: AdminSection;
  role: "ADMIN" | "DEVELOPER";
  onNavigate: (path: string) => void;
}) {
  switch (section) {
    case "dashboard":
      return <AdminDashboard role={role} onNavigate={onNavigate} />;
    case "games":
      return <AdminGames />;
    case "categories":
      return <AdminCategories />;
    case "products":
      return <AdminProducts />;
    case "settings":
      return <AdminSettings />;
    case "checkout":
      return <AdminCheckout />;
  }
}

function DeveloperSectionView({ section, onNavigate }: { section: DeveloperSection; onNavigate: (path: string) => void }) {
  switch (section) {
    case "dashboard":
      return <DevDashboard role="DEVELOPER" onNavigate={onNavigate} />;
    case "access":
      return <DevAccess />;
    case "control":
      return <DevControl />;
    case "git":
      return <DevGit />;
    case "data":
      return <DevData />;
    case "diagnostics":
      return <DevDiagnostics />;
    case "deployment":
      return <DevDeployment />;
  }
}

function NotFoundView() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center sm:px-6">
      <p className="font-display text-6xl font-bold tracking-tight text-primary/25">404</p>
      <h1 className="font-display text-xl font-semibold">Halaman tidak ditemukan</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Alamat yang kamu buka tidak ada atau sudah dipindahkan.
      </p>
      <Button asChild>
        <RouteLink href="/">Kembali ke beranda</RouteLink>
      </Button>
    </main>
  );
}

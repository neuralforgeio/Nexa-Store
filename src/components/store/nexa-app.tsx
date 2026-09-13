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
  const session = useSession();

  const isManagement = route.view === "admin" || route.view === "developer";
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
      navigate("/login");
    }
  }, [session.isPending, session.data, route.view, isManagement, navigate]);

  // Redirect authenticated users away from the login view (effect, not render).
  useEffect(() => {
    if (route.view === "login" && session.data?.authenticated) {
      navigate(session.data.role === "DEVELOPER" ? "/dev" : "/admin", { replace: true });
    }
  }, [route.view, session.data, navigate]);

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

    if (route.view === "developer" && (role === "ADMIN" || role === "DEVELOPER")) {
      if (role !== "DEVELOPER") {
        return (
          <ManagementShell role={role} active={{ group: "developer", key: route.section }} onNavigate={navigate}>
            <ForbiddenForAdmin />
          </ManagementShell>
        );
      }
      return (
        <ManagementShell role={role} active={{ group: "developer", key: route.section }} onNavigate={navigate}>
          <DeveloperSectionView section={route.section} onNavigate={navigate} />
        </ManagementShell>
      );
    }

    return null;
  }, [route, session.data, session.isPending, navigate, isManagement]);

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

function ForbiddenForAdmin() {
  return (
    <ErrorState
      title="Akses ini hanya tersedia untuk Developer."
      description="Peran Admin tidak memiliki alat teknis ini. Batas ini juga ditegakkan di sisi server."
      className="min-h-[50vh]"
    />
  );
}

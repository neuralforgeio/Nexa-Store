"use client";

import { useEffect, useState } from "react";
import { useSession, useLogout, useChatConsole } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { RouteLink } from "@/components/shared/route-link";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/catalog/types";
import type { AdminSection, DeveloperSection } from "@/lib/router";
import {
  Activity,
  AlarmClock,
  BarChart3,
  Database,
  Gamepad2,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  Layers,
  Flag,
  LogOut,
  Megaphone,
  Menu,
  MessageSquareText,
  MessagesSquare,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Percent,
  Power,
  Rocket,
  Settings2,
  ShieldCheck,
  Store,
} from "lucide-react";

type Section =
  | { group: "admin"; key: AdminSection }
  | { group: "developer"; key: DeveloperSection };

type NavEntry<T extends string> = {
  key: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const ADMIN_NAV: Array<NavEntry<AdminSection>> = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "games", label: "Game", icon: Gamepad2 },
  { key: "categories", label: "Kategori", icon: Layers },
  { key: "products", label: "Produk", icon: Package },
  { key: "promo", label: "Event Promo", icon: Percent },
  { key: "banner", label: "Banner", icon: Megaphone },
  { key: "chat", label: "Obrolan", icon: MessagesSquare },
  { key: "reports", label: "Laporan", icon: Flag },
  { key: "settings", label: "Pengaturan", icon: Settings2 },
  { key: "checkout", label: "Checkout", icon: MessageSquareText },
];

/**
 * Nav developer TIDAK mengulang section yang sudah ada di panel admin
 * (promo/banner/chat/reports) — developer melihat ADMIN_NAV juga, jadi
 * section bersama cukup sekali di sana (anti-dobel, v1.6.0).
 * URL /dev/promo dll. tetap berfungsi bila diakses langsung.
 */
const DEVELOPER_NAV: Array<NavEntry<DeveloperSection>> = [
  { key: "dashboard", label: "Developer", icon: ShieldCheck },
  { key: "access", label: "Akses", icon: KeyRound },
  { key: "control", label: "Kontrol Situs", icon: Power },
  { key: "analytics", label: "Analitik", icon: BarChart3 },
  { key: "schedule", label: "Tugas Terjadwal", icon: AlarmClock },
  { key: "git", label: "Git Sync", icon: GitBranch },
  { key: "data", label: "Data Inspector", icon: Database },
  { key: "diagnostics", label: "Diagnostics", icon: Activity },
  { key: "deployment", label: "Deployment", icon: Rocket },
];

const COLLAPSE_KEY = "nexa.sidebar.collapsed";

export function ManagementShell({
  role,
  active,
  onNavigate,
  children,
}: {
  role: Role;
  active: { group: "admin" | "developer"; key: string };
  onNavigate: (path: string) => void;
  children: React.ReactNode;
}) {
  const logout = useLogout();
  // Badge obrolan belum dibaca — polling ringan (30 dtk) untuk item nav "Obrolan".
  const chat = useChatConsole(true, 30_000);
  const chatUnread = chat.data?.unreadTotal ?? 0;
  const [navOpen, setNavOpen] = useState(false);
  // Client-only component (renders after session resolution): the lazy
  // initializer reads localStorage without an effect, so no cascading render.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const isDeveloper = role === "DEVELOPER";
  const panelName = isDeveloper ? "Developer" : "Admin";

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // ignore persistence failure
      }
      return next;
    });
  };

  // Ctrl/Cmd+B toggles the sidebar from anywhere in the dashboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "b") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      toggleCollapsed();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = (s: Section) => active.group === s.group && active.key === s.key;

  const renderNav = (onPick: (path: string) => void, compact = false) => (
    <nav aria-label="Navigasi panel" className="flex min-w-0 flex-col gap-1">
      {/* Group label: text when expanded, a divider when collapsed (never
          overflows the 72px rail — that was the source of the horizontal
          scroll on the sidebar). */}
      {compact ? (
        <span aria-hidden="true" className="mx-auto mt-1 mb-1.5 block h-px w-6 bg-sidebar-border" />
      ) : (
        <p className="px-2 pb-1 pl-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
          Panel
        </p>
      )}
      {ADMIN_NAV.map((item) => (
        <NavItem
          key={item.key}
          icon={item.icon}
          label={item.label}
          href={`/admin/${item.key}`}
          collapsed={compact}
          active={current({ group: "admin", key: item.key })}
          badge={item.key === "chat" ? chatUnread : 0}
          onClick={() => onPick(`/admin/${item.key}`)}
        />
      ))}

      {isDeveloper ? (
        <>
          {compact ? (
            <span aria-hidden="true" className="mx-auto mt-4 mb-1.5 block h-px w-6 bg-sidebar-border" />
          ) : (
            <p className="mt-4 px-2 pb-1 pl-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
              Developer
            </p>
          )}
          {DEVELOPER_NAV.map((item) => (
            <NavItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              href={`/dev/${item.key}`}
              collapsed={compact}
              active={current({ group: "developer", key: item.key })}
              badge={item.key === "chat" ? chatUnread : 0}
              onClick={() => onPick(`/dev/${item.key}`)}
            />
          ))}
        </>
      ) : null}
    </nav>
  );

  const sidebarFooter = (compact = false) => (
    <div className="space-y-1 border-t border-sidebar-border">
      <SidebarAction
        icon={Store}
        label="Lihat store"
        compact={compact}
        onClick={() => onNavigate("/")}
      />
      <SidebarAction
        icon={LogOut}
        label="Keluar"
        compact={compact}
        danger
        onClick={() => logout.mutate()}
      />
    </div>
  );

  return (
    <div className="min-h-dvh bg-background">
      {/* Desktop sidebar — collapsible, no top navbar. */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out lg:flex",
          collapsed ? "w-[72px]" : "w-64"
        )}
      >
        {/* Header — logo with the collapse toggle beside it (Ctrl+B). */}
        <div
          className={cn(
            "flex h-16 shrink-0 items-center border-b border-sidebar-border",
            collapsed ? "flex-col justify-center gap-1.5 px-2" : "justify-between px-4"
          )}
        >
          <RouteLink href="/" className="flex min-w-0 items-center gap-2.5" aria-label="Kembali ke store">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-primary to-primary/80 font-display text-[15px] font-bold text-primary-foreground shadow-[var(--glow-primary)]"
            >
              N
            </span>
            {!collapsed ? (
              <span className="min-w-0">
                <span className="block truncate font-display text-sm font-semibold uppercase leading-tight tracking-tight">
                  Nexa Store
                </span>
                <span className="block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  Panel {panelName}
                </span>
              </span>
            ) : null}
          </RouteLink>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Perlebar sidebar" : "Persempit sidebar"}
            aria-keyshortcuts="Control+B"
            title={collapsed ? "Perlebar sidebar (Ctrl+B)" : "Persempit sidebar (Ctrl+B)"}
            className={cn(
              "flex items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2",
              "h-8 w-8"
            )}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" className="h-4.5 w-4.5" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="h-4.5 w-4.5" />
            )}
          </button>
        </div>

        <div className="scroll-slim flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-2.5">{renderNav(() => undefined, collapsed)}</div>

        <div className="p-2.5">{sidebarFooter(collapsed)}</div>
      </aside>

      {/* Mobile: slim utility bar (menu trigger only, not a site navbar). */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-md lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          aria-label="Buka menu navigasi panel"
          onClick={() => setNavOpen(true)}
        >
          <Menu aria-hidden="true" className="h-4.5 w-4.5" />
        </Button>
        <span className="min-w-0">
          <span className="block truncate font-display text-sm font-semibold leading-tight">
            Nexa Store
          </span>
          <span className="block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Panel {panelName}
          </span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto gap-1.5 text-muted-foreground"
          onClick={() => onNavigate("/")}
        >
          <Store aria-hidden="true" className="h-3.5 w-3.5" />
          Store
        </Button>
      </div>

      {/* Mobile sidebar sheet */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-72 gap-0 border-sidebar-border bg-sidebar p-0">
          <SheetTitle className="sr-only">Menu panel</SheetTitle>
          <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-4">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-primary to-primary/80 font-display text-[15px] font-bold text-primary-foreground"
            >
              N
            </span>
            <span>
              <span className="block font-display text-sm font-semibold uppercase leading-tight tracking-tight">
                Nexa Store
              </span>
              <span className="block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Panel {panelName}
              </span>
            </span>
          </div>
          <div className="scroll-slim flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3">
            {renderNav(() => setNavOpen(false))}
          </div>
          <div className="p-3">{sidebarFooter()}</div>
        </SheetContent>
      </Sheet>

      {/* Main content — offset by the desktop sidebar width. */}
      <div
        className={cn(
          "flex min-h-dvh flex-col transition-[padding] duration-200 ease-out",
          collapsed ? "lg:pl-[72px]" : "lg:pl-64"
        )}
      >
        <div className="hidden items-center gap-3 border-b border-border/70 px-6 py-2 lg:flex">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {isDeveloper ? "Peran: Developer" : "Peran: Admin"}
          </p>
          <p className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
            <kbd className="rounded border border-border bg-surface-1 px-1.5 py-0.5 font-mono text-[10px]">Ctrl</kbd>
            <span className="text-[10px]">+</span>
            <kbd className="rounded border border-border bg-surface-1 px-1.5 py-0.5 font-mono text-[10px]">B</kbd>
            <span className="ml-1">sidebar</span>
          </p>
        </div>
        <main id="main" className="flex-1 p-4 pb-20 sm:p-6 sm:pb-20">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  href,
  collapsed,
  active,
  badge = 0,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  collapsed?: boolean;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <RouteLink
      href={href}
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? (badge > 0 ? `${label} — ${badge} belum dibaca` : label) : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center rounded-lg text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
        collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2",
        active
          ? "bg-primary/15 font-medium text-primary"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute rounded-full bg-primary",
            collapsed ? "left-0 top-1/2 h-6 w-[3px] -translate-y-1/2" : "left-0 top-1/2 h-5 w-[3px] -translate-y-1/2"
          )}
        />
      ) : null}
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {!collapsed ? <span className="truncate">{label}</span> : null}
      {badge > 0 ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold tabular text-white",
            collapsed ? "absolute right-1 top-1 h-4 min-w-4 px-0.5 text-[9px]" : "ml-auto"
          )}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </RouteLink>
  );
}

function SidebarAction({
  icon: Icon,
  label,
  compact,
  danger,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  compact?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={compact ? label : undefined}
      className={cn(
        "flex w-full items-center rounded-lg text-sm transition-colors",
        compact ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2",
        danger
          ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {!compact ? label : null}
    </button>
  );
}

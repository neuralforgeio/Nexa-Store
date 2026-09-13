"use client";

import { RouteLink } from "@/components/shared/route-link";
import { useCatalog } from "@/lib/queries";
import { buildWhatsAppUrl } from "@/lib/whatsapp/url";
import { displayPhone } from "@/lib/format/phone";
import { APP_VERSION } from "@/lib/version";
import { Gamepad2, LifeBuoy, MessageCircle } from "lucide-react";

/** Storefront footer — sits at the bottom of the viewport on short pages. */
export function SiteFooter() {
  const { data } = useCatalog();
  const storeName = data?.store.name ?? "Nexa Store";
  const whatsappNumber = data?.store.whatsappNumber ?? "";

  return (
    <footer className="mt-auto border-t border-border bg-surface-1/60">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-gradient-to-br from-primary to-primary/80 font-display text-[13px] font-bold text-primary-foreground"
              >
                N
              </span>
              <span className="font-display text-sm font-semibold uppercase tracking-tight">
                {storeName}
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Top up game dengan konfirmasi admin lewat WhatsApp. Harga yang
              tampil adalah harga akhir.
            </p>
            {whatsappNumber ? (
              <a
                href={buildWhatsAppUrl(whatsappNumber, "Halo, saya mau tanya soal top up game.")}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-wa/40 bg-wa/10 px-3.5 py-1.5 text-xs font-semibold text-wa transition-colors hover:bg-wa/20"
              >
                <MessageCircle aria-hidden="true" className="h-3.5 w-3.5" />
                <span className="font-mono">{displayPhone(whatsappNumber)}</span>
              </a>
            ) : null}
          </div>

          <nav aria-label="Tautan footer" className="flex gap-10 sm:gap-14">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Store
              </p>
              <ul className="mt-3 space-y-2.5 text-sm">
                <li>
                  <RouteLink href="/games" className="inline-flex items-center gap-2 text-foreground/80 transition-colors hover:text-foreground">
                    <Gamepad2 aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                    Semua game
                  </RouteLink>
                </li>
                <li>
                  <RouteLink href="/help" className="inline-flex items-center gap-2 text-foreground/80 transition-colors hover:text-foreground">
                    <LifeBuoy aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                    Bantuan
                  </RouteLink>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Pesanan diproses pada jam operasional. Konfirmasi terakhir selalu dari admin.
          </p>
          <p className="font-mono text-xs text-muted-foreground/70">v{APP_VERSION}</p>
        </div>
      </div>
    </footer>
  );
}

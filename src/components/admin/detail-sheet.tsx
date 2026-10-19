"use client";

import type { ReactNode, MouseEvent } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type DetailField = {
  label: string;
  value: ReactNode;
  /** Technical value (ids, slugs) → mono with safe wrapping. */
  mono?: boolean;
  /** Long-form value (descriptions, schemas) → full-width row. */
  block?: boolean;
};

/**
 * Shared right-side detail panel for management list rows (v1.12.0).
 * Set like the site's editorial ledger: hairline rows, mono for technical
 * values, muted uppercase labels. Opened by clicking a row; record actions
 * live in the sticky footer.
 */
export function DetailSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  lead,
  badge,
  fields,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Leading visual (e.g. GameMark). */
  lead?: ReactNode;
  /** Compact status pill rendered opposite the title. */
  badge?: ReactNode;
  fields: DetailField[];
  footer?: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b border-border px-5 pt-6 pb-5">
          <div className="flex items-start gap-3.5 pr-6">
            {lead}
            <div className="min-w-0 flex-1">
              <SheetTitle className="font-display leading-tight tracking-tight">
                {title}
              </SheetTitle>
              {subtitle ? (
                <SheetDescription className="mt-1">{subtitle}</SheetDescription>
              ) : null}
            </div>
            {badge ? <div className="shrink-0 pt-0.5">{badge}</div> : null}
          </div>
        </SheetHeader>

        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
          <dl className="px-5 pb-2">
            {fields.map((field) => (
              <div
                key={field.label}
                className={cn(
                  "gap-x-4 gap-y-1 border-b border-border py-3.5 last:border-b-0",
                  field.block
                    ? "grid-cols-1"
                    : "grid grid-cols-[8.5rem_1fr] sm:grid-cols-[9.5rem_1fr]"
                )}
              >
                <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {field.label}
                </dt>
                <dd
                  className={cn(
                    "min-w-0 text-sm leading-relaxed text-foreground/90",
                    field.mono && "font-mono text-xs break-all"
                  )}
                >
                  {field.value === undefined || field.value === null || field.value === ""
                    ? "—"
                    : field.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {footer ? (
          <div className="border-t border-border bg-background px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Row-click guard: opens the detail sheet only when the click did not
 * originate from an interactive control inside the row (switch, button,
 * link, input) — those keep their own behavior.
 */
export function rowClickGuard(handler: () => void): (event: MouseEvent) => void {
  return (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, label, [role='switch'], [role='menu'], [role='combobox']")) {
      return;
    }
    handler();
  };
}

/** Compact status pill used in sheet headers. */
export function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        enabled
          ? "border-primary/25 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground"
      )}
    >
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 rounded-full", enabled ? "bg-primary" : "bg-muted-foreground/60")}
      />
      {enabled ? "Aktif" : "Nonaktif"}
    </span>
  );
}

"use client";

import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

/** Shared loading / empty / error / forbidden states (PRD §25). */

export function LoadingState({ label = "Memuat…", className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex min-h-40 flex-col items-center justify-center gap-3 text-muted-foreground",
        className
      )}
    >
      <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-10 text-center",
        className
      )}
    >
      {icon ? <div aria-hidden="true" className="mb-1 text-muted-foreground/70">{icon}</div> : null}
      <p className="font-display text-base font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Terjadi kesalahan",
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 py-10 text-center",
        className
      )}
    >
      <p className="font-display text-base font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ForbiddenState({ message = "Akses ini hanya tersedia untuk Developer." }: { message?: string }) {
  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-3 py-16 text-center">
      <p className="font-display text-lg font-medium">Akses ditolak</p>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/** Product grid skeleton — keeps layout stable while the catalog loads. */
export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-xl border bg-muted/40" style={{ animationDelay: `${i * 60}ms` }} />
      ))}
    </div>
  );
}

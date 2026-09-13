"use client";

import { cn } from "@/lib/utils";

/** Integer IDR price, mono tabular (D6: numeric data reads as data). */
export function PriceTag({
  value,
  className,
  size = "md",
}: {
  value: number;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const formatted = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

  return (
    <span
      className={cn(
        "font-mono tabular tracking-tight text-foreground",
        size === "sm" && "text-sm",
        size === "md" && "text-base",
        size === "lg" && "text-xl font-medium",
        className
      )}
    >
      {formatted}
    </span>
  );
}

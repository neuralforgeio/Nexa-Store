import { cn } from "@/lib/utils";

/**
 * Logo resmi Nexa Store — "N" emas dengan sparkle (v1.6.0).
 * Dipakai di header, footer, login, widget obrolan, dan layar lain.
 * Logo squircle gelap mandiri → aman di tema terang maupun gelap.
 */
export function BrandMark({
  className,
  size = 28,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <img
      src="/logo.png"
      alt="Logo Nexa Store"
      width={size}
      height={size}
      draggable={false}
      className={cn(
        "shrink-0 rounded-lg object-contain select-none",
        className
      )}
    />
  );
}

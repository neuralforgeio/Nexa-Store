"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Game mark: uploaded icon when available, typographic monogram otherwise.
 * Deterministic muted tone per game name for fast visual scanning.
 */

const TONES = [
  "text-amber-300/95 border-amber-400/25 bg-amber-400/10",
  "text-teal-300/95 border-teal-400/25 bg-teal-400/10",
  "text-rose-300/95 border-rose-400/25 bg-rose-400/10",
  "text-orange-300/95 border-orange-400/25 bg-orange-400/10",
  "text-lime-300/95 border-lime-400/25 bg-lime-400/10",
  "text-fuchsia-300/95 border-fuchsia-400/25 bg-fuchsia-400/10",
];

function toneFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length];
}

function initialsFor(name: string): string {
  const words = name.replace(/[—–-]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const SIZES = {
  sm: "h-9 w-9 text-[11px] rounded-lg",
  md: "h-11 w-11 text-xs rounded-xl",
  lg: "h-14 w-14 text-sm rounded-xl",
  xl: "h-20 w-20 text-base rounded-2xl",
} as const;

export function GameMark({
  name,
  image,
  size = "md",
  className,
}: {
  name: string;
  image?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = image && !broken;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden border font-display font-semibold tracking-wide",
        !showImage && toneFor(name),
        SIZES[size],
        className
      )}
    >
      {showImage ? (
        // Uploaded icons are paths or data URIs; both are store-controlled.
        <img
          src={image}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        initialsFor(name)
      )}
    </span>
  );
}

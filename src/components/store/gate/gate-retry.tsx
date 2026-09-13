"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCcw } from "lucide-react";

/**
 * Retry button on the gate screens: re-probes /api/store-status and returns
 * to the storefront as soon as the Developer lifts the gate.
 */
export function GateRetryButton({
  gate,
  label = "Coba akses lagi",
  className,
}: {
  gate: "lockdown" | "maintenance";
  label?: string;
  className?: string;
}) {
  const [checking, setChecking] = useState(false);
  const [denied, setDenied] = useState(false);

  const retry = async () => {
    setChecking(true);
    setDenied(false);
    try {
      const res = await fetch(`/api/store-status?path=${encodeURIComponent("/")}`);
      const json = (await res.json()) as {
        ok: boolean;
        data?: {
          lockdown: { applies: boolean };
          maintenance: { applies: boolean };
        };
      };
      const applies = json.data ? json.data[gate].applies : true;
      if (!applies) {
        window.location.href = "/";
        return;
      }
      setDenied(true);
    } catch {
      setDenied(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className={className}>
      <Button
        type="button"
        size="lg"
        onClick={retry}
        disabled={checking}
        className="w-full gap-2 font-semibold sm:w-auto"
      >
        {checking ? (
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : (
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
        )}
        {label}
      </Button>
      {denied ? (
        <p role="status" className="mt-3 text-xs opacity-70">
          Situs masih dalam mode {gate === "lockdown" ? "lockdown" : "pemeliharaan"}. Coba lagi nanti.
        </p>
      ) : null}
    </div>
  );
}

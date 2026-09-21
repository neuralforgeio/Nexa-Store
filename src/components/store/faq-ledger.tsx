"use client";

import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { cn } from "@/lib/utils";

export type FaqEntry = { q: string; a: string };

/**
 * FAQ ledger — a numbered disclosure list, set like the index of a manual.
 *
 * Radix accordion semantics underneath, but a fully custom face: mono index
 * numbers, hairline rows, a plus→minus morph toggle, and an amber rail that
 * draws down the left edge of the open entry. Answers hang indented under
 * their question so the scan line stays straight.
 */
export function FaqLedger({
  items,
  className,
  defaultKey,
}: {
  items: readonly FaqEntry[];
  className?: string;
  defaultKey?: string;
}) {
  return (
    <AccordionPrimitive.Root
      type="single"
      collapsible
      defaultValue={defaultKey}
      className={className}
    >
      {items.map((item, i) => {
        const key = `faq-${i}`;
        return (
          <AccordionPrimitive.Item
            key={key}
            value={key}
            className="group relative border-b border-border last:border-b-0"
          >
            {/* Amber rail marking the open entry. */}
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-[2px] origin-top scale-y-0 bg-primary transition-transform duration-300 ease-out group-data-[state=open]:scale-y-100"
            />

            <AccordionPrimitive.Header className="flex">
              <AccordionPrimitive.Trigger
                className={cn(
                  "flex flex-1 select-none items-start gap-3 rounded-md py-4 pr-3 text-left outline-none",
                  "transition-colors duration-150 hover:bg-accent/40",
                  "focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  "sm:gap-4 sm:py-5"
                )}
              >
                <span
                  aria-hidden="true"
                  className="mt-[3px] w-6 shrink-0 font-mono text-[11px] font-semibold tabular text-muted-foreground/70 transition-colors duration-150 group-hover:text-primary group-data-[state=open]:text-primary"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 font-display text-sm font-semibold leading-snug sm:text-[15px]">
                  {item.q}
                </span>
                {/* Plus→minus morph toggle — two bars, the upright one folds away. */}
                <span
                  aria-hidden="true"
                  className="relative mt-[3px] h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-colors duration-200 group-hover:text-primary group-data-[state=open]:text-primary"
                >
                  <span className="absolute left-1/2 top-1/2 h-px w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
                  <span className="absolute left-1/2 top-1/2 h-3.5 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-current transition-transform duration-300 ease-out group-data-[state=open]:scale-y-0" />
                </span>
              </AccordionPrimitive.Trigger>
            </AccordionPrimitive.Header>

            <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
              {/* Spacer matches the index column so the answer hangs under the question. */}
              <div className="flex gap-3 pb-5 pr-3 sm:gap-4">
                <span aria-hidden="true" className="w-6 shrink-0" />
                <p className="min-w-0 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {item.a}
                </p>
              </div>
            </AccordionPrimitive.Content>
          </AccordionPrimitive.Item>
        );
      })}
    </AccordionPrimitive.Root>
  );
}

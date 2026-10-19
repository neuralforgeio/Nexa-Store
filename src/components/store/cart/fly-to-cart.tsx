"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";

/**
 * Fly-to-cart animation layer.
 *
 * Product cards dispatch {@link FLY_TO_CART_EVENT} on window after a
 * successful quick-add. This layer answers with a small game tile that arcs
 * from the card's game mark to the header cart button, chased by three
 * fading ghost mini-tiles (the trail). When the icon lands it fires
 * {@link CART_ARRIVAL_EVENT} so other surfaces can react.
 *
 * - Multiple simultaneous flights stack (one entry per event).
 * - `useReducedMotion` → the listener is never attached, nothing renders.
 * - All `window`/`document` access lives inside effects (SSR-safe).
 */

/** Fired on window by product cards: `detail: FlyToCartDetail`. */
export const FLY_TO_CART_EVENT = "nexa:fly-to-cart";

/** Fired on window when the flying icon lands on the cart button. */
export const CART_ARRIVAL_EVENT = "nexa:cart-arrival";

export type FlyToCartDetail = {
  /** Viewport rect of the source element (the card's game mark / card). */
  rect: DOMRect;
  /** Game image URL or data URI; null renders the initial tile fallback. */
  image: string | null;
  /** Game name — fallback initial for the tile. */
  name: string;
};

type Point = { x: number; y: number };

type Flight = {
  id: number;
  /** Arc path centers (viewport px): source → apex → cart button. */
  src: Point;
  mid: Point;
  dst: Point;
  image: string | null;
  name: string;
};

type Ghost = {
  /** Tile size in px (14–18 per spec). */
  size: number;
  /** Launch delay behind the main tile, in seconds. */
  delay: number;
  scale: number[];
  opacity: number[];
};

/** Main flying tile (28–32px per spec). */
const MAIN_SIZE = 30;
/** Flight duration (~0.7s per spec). */
const DURATION = 0.7;
/** Apex height above the straight line. */
const ARC_RISE = 80;
/** Keep the apex on screen (tiles must not vanish above the viewport). */
const APEX_MIN_Y = 24;

/** Ghost trail — same arc, staggered behind the main tile. */
const GHOSTS: Ghost[] = [
  { size: 18, delay: 0.09, scale: [0.9, 0.78, 0.28], opacity: [0.5, 0.5, 0.45] },
  { size: 16, delay: 0.18, scale: [0.85, 0.72, 0.26], opacity: [0.35, 0.35, 0.3] },
  { size: 14, delay: 0.27, scale: [0.8, 0.68, 0.24], opacity: [0.2, 0.2, 0.18] },
];

/** Header cart button center; fixed top-right estimate until it is mounted. */
function cartTarget(): Point {
  const btn = document.querySelector<HTMLElement>("[data-cart-button]");
  if (btn) {
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: window.innerWidth - 24, y: 28 };
}

function arcTransition(delay = 0): Transition {
  return { duration: DURATION, delay, times: [0, 0.5, 1], ease: ["easeIn", "easeOut"] };
}

/** left/top keyframes for a tile of `size` px following the flight arc. */
function arcKeyframes(flight: Flight, size: number) {
  const d = size / 2;
  const { src, mid, dst } = flight;
  return {
    left: [src.x - d, mid.x - d, dst.x - d],
    top: [src.y - d, mid.y - d, dst.y - d],
  };
}

export function FlyToCartLayer() {
  const [flights, setFlights] = useState<Flight[]>([]);
  const seq = useRef(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;

    const onFly = (event: Event) => {
      const detail = (event as CustomEvent<FlyToCartDetail>).detail;
      const rect = detail?.rect;
      if (!rect || typeof rect.left !== "number" || typeof rect.top !== "number") return;

      const src: Point = {
        x: rect.left + (typeof rect.width === "number" ? rect.width / 2 : 0),
        y: rect.top + (typeof rect.height === "number" ? rect.height / 2 : 0),
      };
      const dst = cartTarget();
      // Curved arc: control point above the straight line, clamped on screen.
      const mid: Point = {
        x: (src.x + dst.x) / 2,
        y: Math.max(Math.min(src.y, dst.y) - ARC_RISE, APEX_MIN_Y),
      };

      const flight: Flight = {
        id: ++seq.current,
        src,
        mid,
        dst,
        image: typeof detail.image === "string" && detail.image ? detail.image : null,
        name: typeof detail.name === "string" ? detail.name : "",
      };
      setFlights((prev) => [...prev, flight]);
    };

    window.addEventListener(FLY_TO_CART_EVENT, onFly);
    return () => window.removeEventListener(FLY_TO_CART_EVENT, onFly);
  }, [reducedMotion]);

  const finishFlight = useCallback((id: number) => {
    setFlights((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60]">
      {flights.map((flight) => (
        <div key={flight.id} className="absolute inset-0">
          {/* Ghost trail — mini tiles chasing the main icon along the arc. */}
          {GHOSTS.map((ghost) => (
            <motion.div
              key={ghost.delay}
              className="absolute"
              style={{
                width: ghost.size,
                height: ghost.size,
                left: flight.src.x - ghost.size / 2,
                top: flight.src.y - ghost.size / 2,
              }}
              animate={{
                ...arcKeyframes(flight, ghost.size),
                scale: ghost.scale,
                opacity: ghost.opacity,
              }}
              transition={arcTransition(ghost.delay)}
            >
              <FlyTile flight={flight} size={ghost.size} />
            </motion.div>
          ))}

          {/* Main icon — lands on the cart button, then the flight is removed. */}
          <motion.div
            className="absolute"
            style={{
              width: MAIN_SIZE,
              height: MAIN_SIZE,
              left: flight.src.x - MAIN_SIZE / 2,
              top: flight.src.y - MAIN_SIZE / 2,
            }}
            animate={{
              ...arcKeyframes(flight, MAIN_SIZE),
              scale: [1, 0.85, 0.3],
              opacity: [1, 1, 0.9],
            }}
            transition={arcTransition()}
            onAnimationComplete={() => {
              finishFlight(flight.id);
              window.dispatchEvent(new CustomEvent(CART_ARRIVAL_EVENT));
            }}
          >
            <FlyTile flight={flight} size={MAIN_SIZE} />
          </motion.div>
        </div>
      ))}
    </div>
  );
}

/** The flying tile: game image, or an initial tile when there is no image. */
function FlyTile({ flight, size }: { flight: Flight; size: number }) {
  const radius = size >= MAIN_SIZE ? "rounded-md" : "rounded-[5px]";
  if (flight.image) {
    return (
      <img
        src={flight.image}
        alt=""
        draggable={false}
        className={`h-full w-full border border-border object-cover shadow-card ${radius}`}
      />
    );
  }
  return (
    <span
      className={`flex h-full w-full items-center justify-center border border-primary/30 bg-primary/15 font-display font-semibold text-primary shadow-card ${radius}`}
      style={{ fontSize: size >= MAIN_SIZE ? 12 : 8 }}
    >
      {initialsFor(flight.name)}
    </span>
  );
}

/** Two-letter monogram, mirroring GameMark's fallback. */
function initialsFor(name: string): string {
  const words = name.replace(/[—–-]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0]! + words[1][0]!).toUpperCase();
}

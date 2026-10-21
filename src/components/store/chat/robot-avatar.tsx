"use client";

/**
 * RobotAvatar — hand-crafted inline-SVG mascot for the NEXA STORE chat surfaces
 * (floating chat FAB + chat panel header).
 *
 * Design: graphite head shell with a vertical zinc gradient, thin amber top-edge
 * highlight, glowing amber eyes on a near-black face screen, and a pulsing amber
 * antenna tip. All colors are explicit SVG colors so the mascot reads identically
 * on dark graphite and warm-paper light backgrounds.
 *
 * Behavior:
 * - `trackPointer`  pupils glide toward the global pointer (rAF-throttled,
 *   spring-smoothed, motion-value driven — zero React re-renders per frame) and
 *                   drift back home after 4s of pointer inactivity.
 * - moods          drive eye shape, antenna light cadence and mouth:
 *                   idle (round + blink), alert (wide, no blink),
 *                   happy (^-^ arcs + open smile), typing (up-look + slow sway).
 * - `animateJump`   periodic gentle hop every 5–8s; pressing the avatar fires an
 *                   excited hop plus a 900ms "happy" flash.
 * - prefers-reduced-motion renders a calm, static mascot.
 *
 * Self-contained: imports only react + framer-motion.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactElement } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useAnimationControls,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";

export type RobotMood = "idle" | "alert" | "happy" | "typing";

interface RobotAvatarProps {
  /** Rendered square size in px. Default 44. */
  size?: number;
  /** Mood drives eye shape + antenna light behavior. Default "idle". */
  mood?: RobotMood;
  /** When true, pupils follow the global pointer (cursor position + taps/clicks). Default false. */
  trackPointer?: boolean;
  /** Periodic gentle hop animation. Default true. Disabled automatically under prefers-reduced-motion. */
  animateJump?: boolean;
  className?: string;
}

/* ------------------------------------------------------------------ */
/* Geometry — viewBox 0 0 64 64                                        */
/* ------------------------------------------------------------------ */

const EYE_XS = [25.3, 38.7] as const;
const EYE_Y = 32.6;
const PUPIL_R_IDLE = 2.75;
const PUPIL_R_ALERT = 3.4;
const BLINK_RY = 0.28;
/** 64 * 0.045 svg units — renders as `size * 0.045` px at any size. */
const MAX_EYE_TRAVEL = 64 * 0.045;
/** Pointer distance (screen px) at which the pupils reach full deflection. */
const EYE_REACH_PX = 130;
/** Pointer inactivity before the pupils drift home. */
const EYE_IDLE_MS = 4000;

const SMILE_PATH = "M28.7 39.7 Q32 42.6 35.3 39.7";
const HAPPY_MOUTH_PATH = "M26.9 39.2 C27.8 45.1 36.2 45.1 37.1 39.2 Z";

const happyEyePath = (cx: number): string =>
  `M${(cx - 3.4).toFixed(1)} 33.7 Q${cx} 29.9 ${(cx + 3.4).toFixed(1)} 33.7`;

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function RobotAvatar({
  size = 44,
  mood = "idle",
  trackPointer = false,
  animateJump = true,
  className,
}: RobotAvatarProps): ReactElement {
  const reduced = useReducedMotion() ?? false;

  /* --- interaction state (rare re-renders only) -------------------- */
  const [blinking, setBlinking] = useState(false);
  const [flashHappy, setFlashHappy] = useState(false);
  const effectiveMood: RobotMood = flashHappy ? "happy" : mood;
  const isHappy = effectiveMood === "happy";
  const isTyping = effectiveMood === "typing";
  const isAlert = effectiveMood === "alert";

  const rootRef = useRef<HTMLSpanElement | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /* --- hop (imperative keyframes on the root element) --------------- */
  const hopControls = useAnimationControls();

  const startHop = useCallback(
    (excited: boolean) => {
      const jump = excited ? -size * 0.22 : -size * 0.1;
      void hopControls.start(
        {
          y: excited ? [0, 0, jump, -size * 0.04, 0] : [0, 0, jump, 0, 0],
          scaleY: excited ? [1, 0.9, 1.1, 0.96, 1] : [1, 0.92, 1.06, 0.97, 1],
          scaleX: excited ? [1, 1.07, 0.96, 1.02, 1] : [1, 1.05, 0.985, 1.015, 1],
        },
        {
          duration: excited ? 0.72 : 0.62,
          times: [0, 0.18, 0.56, 0.8, 1],
          ease: ["easeInOut", "easeOut", "easeIn", "easeOut"],
        },
      );
    },
    [hopControls, size],
  );

  /* periodic gentle hop, every 5–8s */
  useEffect(() => {
    if (reduced || !animateJump) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(() => {
        if (cancelled) return;
        startHop(false);
        schedule();
      }, 5000 + Math.random() * 3000);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [reduced, animateJump, startHop]);

  /* excited hop + happy flash when the avatar itself is pressed */
  const handlePointerDown = useCallback(
    (_event: ReactPointerEvent<HTMLSpanElement>) => {
      if (!reduced) startHop(true);
      setFlashHappy(true);
      if (flashTimer.current !== undefined) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashHappy(false), 900);
    },
    [reduced, startHop],
  );

  useEffect(
    () => () => {
      if (flashTimer.current !== undefined) clearTimeout(flashTimer.current);
    },
    [],
  );

  /* --- pointer tracking (motion values only — no per-frame renders) - */
  const eyeTargetX = useMotionValue(0);
  const eyeTargetY = useMotionValue(0);
  const eyeX = useSpring(eyeTargetX, { stiffness: 170, damping: 14, mass: 0.55 });
  const eyeY = useSpring(eyeTargetY, { stiffness: 170, damping: 14, mass: 0.55 });

  useEffect(() => {
    if (!trackPointer || reduced) {
      eyeTargetX.set(0);
      eyeTargetY.set(0);
      return;
    }
    let raf = 0;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let px = 0;
    let py = 0;

    const update = () => {
      raf = 0;
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dx = px - (rect.left + rect.width / 2);
      const dy = py - (rect.top + rect.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist < 0.5) {
        eyeTargetX.set(0);
        eyeTargetY.set(0);
        return;
      }
      const reach = Math.min(1, dist / EYE_REACH_PX);
      const travel = reach * MAX_EYE_TRAVEL;
      eyeTargetX.set((dx / dist) * travel);
      eyeTargetY.set((dy / dist) * travel);
    };

    const onPointer = (event: PointerEvent) => {
      px = event.clientX;
      py = event.clientY;
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        eyeTargetX.set(0);
        eyeTargetY.set(0);
      }, EYE_IDLE_MS);
      if (raf === 0) raf = requestAnimationFrame(update);
    };

    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      if (raf !== 0) cancelAnimationFrame(raf);
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      eyeTargetX.set(0);
      eyeTargetY.set(0);
    };
  }, [trackPointer, reduced, eyeTargetX, eyeTargetY]);

  /* --- blink (idle mood only) --------------------------------------- */
  const canBlink = effectiveMood === "idle" && !reduced;
  const isBlinking = canBlink && blinking;

  /* the blink loop reads the live mood when each cycle fires, so mood
     changes never leave the eyes stuck closed (and never re-render) */
  const moodRef = useRef<RobotMood>(effectiveMood);
  useEffect(() => {
    moodRef.current = effectiveMood;
  }, [effectiveMood]);

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleBlink = () => {
      closeTimer = setTimeout(() => {
        if (cancelled) return;
        if (moodRef.current === "idle") {
          setBlinking(true);
          openTimer = setTimeout(() => {
            if (cancelled) return;
            setBlinking(false);
            scheduleBlink();
          }, 120);
        } else {
          setBlinking(false);
          scheduleBlink();
        }
      }, 3500 + Math.random() * 2000);
    };
    scheduleBlink();
    return () => {
      cancelled = true;
      if (closeTimer !== undefined) clearTimeout(closeTimer);
      if (openTimer !== undefined) clearTimeout(openTimer);
    };
  }, [reduced]);

  /* --- pupil radius (motion value bound to the `rx`/`ry` attributes) - */
  const pupilR = isAlert ? PUPIL_R_ALERT : PUPIL_R_IDLE;
  const pupilRx = useMotionValue(pupilR);
  const pupilRy = useMotionValue(pupilR);
  const haloR = useTransform(pupilRx, (r) => r + 1.25);

  useEffect(() => {
    const rxAnim = animate(pupilRx, pupilR, { duration: 0.22, ease: "easeOut" });
    const ryAnim = animate(
      pupilRy,
      isBlinking ? BLINK_RY : pupilR,
      { duration: isBlinking ? 0.06 : 0.1, ease: "easeOut" },
    );
    return () => {
      rxAnim.stop();
      ryAnim.stop();
    };
  }, [isBlinking, pupilR, pupilRx, pupilRy]);

  /* --- mood-driven animations --------------------------------------- */
  const fadeTransition = useMemo(
    () => ({ duration: reduced ? 0 : 0.14, ease: "easeOut" as const }),
    [reduced],
  );

  const antennaAnimate = useMemo<{ opacity: number | number[] }>(() => {
    if (reduced) return { opacity: 0.9 };
    switch (effectiveMood) {
      case "alert":
        return { opacity: 1 };
      case "typing":
        return { opacity: [1, 0.2, 1] };
      case "happy":
        return { opacity: [0.6, 1, 0.6] };
      default:
        return { opacity: [0.45, 1, 0.45] };
    }
  }, [effectiveMood, reduced]);

  const antennaTransition = useMemo(() => {
    switch (effectiveMood) {
      case "typing":
        return { duration: 0.5, repeat: Infinity, ease: "easeInOut" as const };
      case "happy":
        return { duration: 1.15, repeat: Infinity, ease: "easeInOut" as const };
      case "alert":
        return { duration: 0.2 };
      default:
        return { duration: 2.4, repeat: Infinity, ease: "easeInOut" as const };
    }
  }, [effectiveMood]);

  const earLedOpacity = isAlert ? 0.95 : isHappy ? 0.85 : isTyping ? 0.8 : 0.55;

  /* typing: pupils look up and sway side to side; otherwise recenter.
     y is a constant-keyframe track so it holds at -1.5 for the whole
     looping sway instead of sawtoothing back to 0 every cycle. */
  const swayAnimate = useMemo(() => {
    if (isTyping) {
      return reduced
        ? { x: -0.5, y: -1.5 }
        : { x: [-1.35, 1.35, -1.35], y: [-1.5, -1.5, -1.5] };
    }
    return { x: 0, y: 0 };
  }, [isTyping, reduced]);

  const swayTransition = useMemo(
    () =>
      isTyping && !reduced
        ? { duration: 2.8, repeat: Infinity, ease: "easeInOut" as const }
        : { duration: 0.35, ease: "easeOut" as const },
    [isTyping, reduced],
  );

  /* --- unique svg ids (two instances live on the same page) ---------- */
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gid = useCallback(
    (name: string) => `nexa-${name}-${uid}`,
    [uid],
  );

  return (
    <motion.span
      ref={rootRef}
      role="img"
      aria-label="Nexa robot mascot"
      className={className}
      onPointerDown={handlePointerDown}
      animate={hopControls}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        flex: "none",
        originX: 0.5,
        originY: 1,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-hidden="true"
        focusable="false"
        style={{ display: "block" }}
      >
        <defs>
          <linearGradient id={gid("head")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3d3d46" />
            <stop offset="0.5" stopColor="#2a2a31" />
            <stop offset="1" stopColor="#1d1d24" />
          </linearGradient>
          <linearGradient id={gid("ear")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4a4a54" />
            <stop offset="1" stopColor="#2b2b33" />
          </linearGradient>
          <linearGradient
            id={gid("edge")}
            gradientUnits="userSpaceOnUse"
            x1="32"
            y1="11.6"
            x2="32"
            y2="19.5"
          >
            <stop offset="0" stopColor="#fcd34d" stopOpacity="0.9" />
            <stop offset="0.55" stopColor="#f59e0b" stopOpacity="0.3" />
            <stop offset="1" stopColor="#f59e0b" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id={gid("shade")}
            gradientUnits="userSpaceOnUse"
            x1="32"
            y1="47"
            x2="32"
            y2="56"
          >
            <stop offset="0" stopColor="#000000" stopOpacity="0" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.4" />
          </linearGradient>
          <radialGradient
            id={gid("screen")}
            gradientUnits="userSpaceOnUse"
            cx="32"
            cy="23"
            r="26"
          >
            <stop offset="0" stopColor="#f59e0b" stopOpacity="0.13" />
            <stop offset="0.55" stopColor="#f59e0b" stopOpacity="0.05" />
            <stop offset="1" stopColor="#f59e0b" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={gid("eye")} cx="0.38" cy="0.34" r="0.85">
            <stop offset="0" stopColor="#fff9e6" />
            <stop offset="0.32" stopColor="#fde68a" />
            <stop offset="0.68" stopColor="#fbbf24" />
            <stop offset="1" stopColor="#d97706" />
          </radialGradient>
          <radialGradient id={gid("antglow")}>
            <stop offset="0" stopColor="#fde68a" stopOpacity="0.95" />
            <stop offset="0.4" stopColor="#f59e0b" stopOpacity="0.4" />
            <stop offset="1" stopColor="#f59e0b" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={gid("tip")} cx="0.38" cy="0.35" r="0.9">
            <stop offset="0" stopColor="#fffbef" />
            <stop offset="0.5" stopColor="#fcd34d" />
            <stop offset="1" stopColor="#f59e0b" />
          </radialGradient>
          <linearGradient id={gid("mouth")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fcd34d" />
            <stop offset="1" stopColor="#d97706" />
          </linearGradient>
          <filter id={gid("blur")} x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="1.15" />
          </filter>
        </defs>

        {/* antenna — glow halo, stem, hot tip */}
        <motion.circle
          cx={32}
          cy={5.9}
          r={5.3}
          fill={`url(#${gid("antglow")})`}
          initial={false}
          animate={antennaAnimate}
          transition={antennaTransition}
        />
        <path d="M32 13.4 V8.6" stroke="#575763" strokeWidth={1.5} strokeLinecap="round" />
        <circle cx={32} cy={5.9} r={1.75} fill={`url(#${gid("tip")})`} />

        {/* ear pods + status leds */}
        <rect
          x={5.7}
          y={26.3}
          width={5.1}
          height={13}
          rx={2.55}
          fill={`url(#${gid("ear")})`}
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={1}
        />
        <rect
          x={53.2}
          y={26.3}
          width={5.1}
          height={13}
          rx={2.55}
          fill={`url(#${gid("ear")})`}
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={1}
        />
        <motion.circle
          cx={7.9}
          cy={32.8}
          r={0.8}
          fill="#f59e0b"
          initial={false}
          animate={{ opacity: earLedOpacity }}
          transition={{ duration: 0.3 }}
        />
        <motion.circle
          cx={56.1}
          cy={32.8}
          r={0.8}
          fill="#f59e0b"
          initial={false}
          animate={{ opacity: earLedOpacity }}
          transition={{ duration: 0.3 }}
        />

        {/* head shell */}
        <rect
          x={9.4}
          y={12.9}
          width={45.2}
          height={42.2}
          rx={13.6}
          fill={`url(#${gid("head")})`}
          stroke="rgba(255,255,255,0.09)"
          strokeWidth={1}
        />
        {/* amber top-edge light catch */}
        <rect
          x={9.4}
          y={12.9}
          width={45.2}
          height={42.2}
          rx={13.6}
          fill="none"
          stroke={`url(#${gid("edge")})`}
          strokeWidth={1.3}
        />
        {/* soft bottom occlusion */}
        <rect
          x={9.4}
          y={12.9}
          width={45.2}
          height={42.2}
          rx={13.6}
          fill="none"
          stroke={`url(#${gid("shade")})`}
          strokeWidth={1.2}
        />
        {/* corner sheen */}
        <path
          d="M12.6 23.4 Q12.6 16 20 16"
          fill="none"
          stroke="rgba(255,255,255,0.09)"
          strokeWidth={2.2}
          strokeLinecap="round"
        />

        {/* face screen + faint amber inner glow */}
        <rect
          x={14.5}
          y={18.7}
          width={35}
          height={29.3}
          rx={10}
          fill="#0b0d10"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={1}
        />
        <rect
          x={16.6}
          y={20.6}
          width={30.8}
          height={25.4}
          rx={8}
          fill={`url(#${gid("screen")})`}
        />

        {/* eyes — outer group follows the pointer, inner group sways when thinking */}
        {EYE_XS.map((cx) => (
          <motion.g key={cx} style={{ x: eyeX, y: eyeY }}>
            <motion.g animate={swayAnimate} transition={swayTransition}>
              <AnimatePresence initial={false}>
                {isHappy ? (
                  <motion.g
                    key="happy"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={fadeTransition}
                  >
                    <path
                      d={happyEyePath(cx)}
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth={3.6}
                      strokeLinecap="round"
                      opacity={0.3}
                      filter={`url(#${gid("blur")})`}
                    />
                    <path
                      d={happyEyePath(cx)}
                      fill="none"
                      stroke="#fbbf24"
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  </motion.g>
                ) : (
                  <motion.g
                    key="round"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={fadeTransition}
                  >
                    <motion.circle
                      cx={cx}
                      cy={EYE_Y}
                      r={haloR}
                      fill="#f59e0b"
                      filter={`url(#${gid("blur")})`}
                      animate={{ opacity: isBlinking ? 0.16 : isAlert ? 0.42 : 0.34 }}
                      transition={{ duration: 0.08 }}
                    />
                    <motion.ellipse
                      cx={cx}
                      cy={EYE_Y}
                      rx={pupilRx}
                      ry={pupilRy}
                      fill={`url(#${gid("eye")})`}
                    />
                    <motion.circle
                      cx={cx - 0.9}
                      cy={EYE_Y - 0.95}
                      r={0.55}
                      fill="#ffffff"
                      animate={{ opacity: isBlinking ? 0 : 0.85 }}
                      transition={{ duration: 0.05 }}
                    />
                  </motion.g>
                )}
              </AnimatePresence>
            </motion.g>
          </motion.g>
        ))}

        {/* mouth */}
        <AnimatePresence initial={false}>
          {isHappy ? (
            <motion.path
              key="mouth-happy"
              d={HAPPY_MOUTH_PATH}
              fill={`url(#${gid("mouth")})`}
              stroke={`url(#${gid("mouth")})`}
              strokeWidth={1.4}
              strokeLinejoin="round"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fadeTransition}
            />
          ) : isTyping ? (
            <motion.g
              key="mouth-typing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fadeTransition}
            >
              {[29.2, 32, 34.8].map((dotX, i) => (
                <motion.circle
                  key={dotX}
                  cx={dotX}
                  cy={40.4}
                  r={0.85}
                  fill="#fbbf24"
                  animate={
                    reduced ? { opacity: 0.55 } : { opacity: [0.2, 1, 0.2] }
                  }
                  transition={
                    reduced
                      ? { duration: 0 }
                      : {
                          duration: 1.1,
                          repeat: Infinity,
                          ease: "easeInOut",
                          delay: i * 0.18,
                        }
                  }
                />
              ))}
            </motion.g>
          ) : (
            <motion.path
              key="mouth-smile"
              d={SMILE_PATH}
              fill="none"
              stroke="#b4b4c0"
              strokeWidth={1.7}
              strokeLinecap="round"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fadeTransition}
            />
          )}
        </AnimatePresence>
      </svg>
    </motion.span>
  );
}

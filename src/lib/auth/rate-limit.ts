/**
 * In-memory sliding-window rate limiter for the login mutation (PRD §8.3).
 * Limitation (documented A8/R4): per-instance on serverless — acceptable
 * "basic abuse protection where feasible"; production upgrade = shared store.
 */

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

type Attempt = { at: number };

const buckets = new Map<string, Attempt[]>();

// Periodic sweep to bound memory (R4 mitigation).
const SWEEP_INTERVAL_MS = 60 * 1000;
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, attempts] of buckets) {
    const live = attempts.filter((a) => now - a.at < WINDOW_MS);
    if (live.length === 0) buckets.delete(key);
    else buckets.set(key, live);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
};

export function checkRateLimit(key: string, now: number = Date.now()): RateLimitResult {
  sweep(now);
  const attempts = (buckets.get(key) ?? []).filter((a) => now - a.at < WINDOW_MS);
  if (attempts.length >= MAX_ATTEMPTS) {
    const oldest = Math.min(...attempts.map((a) => a.at));
    const retryAfterSeconds = Math.ceil((oldest + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1), remaining: 0 };
  }
  return { allowed: true, retryAfterSeconds: 0, remaining: MAX_ATTEMPTS - attempts.length };
}

export function recordAttempt(key: string, now: number = Date.now()): void {
  const attempts = (buckets.get(key) ?? []).filter((a) => now - a.at < WINDOW_MS);
  attempts.push({ at: now });
  buckets.set(key, attempts);
}

/** Test hook. */
export function resetRateLimiter(): void {
  buckets.clear();
}

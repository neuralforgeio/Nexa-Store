/**
 * Circuit breaker (v1.8.0) — isolasi kegagalan antar dependensi eksternal.
 *
 * Prinsip: kalau satu dependensi (GitHub API, Telegram API, layanan bot)
 * bermasalah, kegagalan itu DIPUTUS di sini — tidak boleh merambat ke
 * request lain, apalagi menjatuhkan seluruh website. Pola klasik:
 *
 *   CLOSED  → lalu lintas normal; kegagalan dihitung.
 *   OPEN    → setelah N kegagalan beruntun, semua panggilan langsung
 *             ditolak (fail-fast, tanpa menunggu timeout) selama masa
 *             cooldown. Pemanggil memakai fallback-nya masing-masing.
 *   HALF-OPEN → setelah cooldown, satu panggilan percobaan diizinkan;
 *             sukses 2× berturut-turut → CLOSED lagi, gagal → OPEN lagi.
 *
 * Semua breaker berbagi satu registry supaya satu proses punya satu status
 * per dependensi (modul mana pun yang pertama memanggil akan mengaktifkan
 * proteksi yang sama).
 */

export type CircuitState = "closed" | "open" | "half-open";

export class CircuitOpenError extends Error {
  constructor(name: string, retryInMs: number) {
    super(`Circuit breaker "${name}" terbuka — coba lagi dalam ${Math.ceil(retryInMs / 1000)}s.`);
    this.name = "CircuitOpenError";
  }
}

type BreakerOptions = {
  /** Jumlah kegagalan beruntun sebelum circuit terbuka. */
  failureThreshold: number;
  /** Lama circuit terbuka sebelum mencoba lagi (ms). */
  cooldownMs: number;
  /** Sukses berturut-turut di half-open sebelum menutup kembali. */
  halfOpenSuccessThreshold: number;
};

const DEFAULTS: BreakerOptions = {
  failureThreshold: 4,
  cooldownMs: 45_000,
  halfOpenSuccessThreshold: 2,
};

export class CircuitBreaker {
  readonly name: string;
  private readonly opts: BreakerOptions;
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private halfOpenSuccesses = 0;
  private openedAt = 0;
  /** Untuk observabilitas (panel debugging). */
  lastError: string | null = null;
  lastStateChange: string = new Date().toISOString();

  constructor(name: string, opts?: Partial<BreakerOptions>) {
    this.name = name;
    this.opts = { ...DEFAULTS, ...opts };
  }

  snapshot(): {
    name: string;
    state: CircuitState;
    consecutiveFailures: number;
    retryInMs: number;
    lastError: string | null;
  } {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      retryInMs: this.state === "open" ? Math.max(0, this.opts.cooldownMs - (Date.now() - this.openedAt)) : 0,
      lastError: this.lastError,
    };
  }

  private transition(next: CircuitState) {
    if (this.state !== next) {
      this.state = next;
      this.lastStateChange = new Date().toISOString();
    }
  }

  private beforeCall(): void {
    if (this.state === "open") {
      if (Date.now() - this.openedAt >= this.opts.cooldownMs) {
        this.transition("half-open");
        this.halfOpenSuccesses = 0;
        return;
      }
      throw new CircuitOpenError(this.name, this.opts.cooldownMs - (Date.now() - this.openedAt));
    }
    // closed / half-open → boleh lewat.
  }

  private onSuccess(): void {
    this.lastError = null;
    if (this.state === "half-open") {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.opts.halfOpenSuccessThreshold) {
        this.consecutiveFailures = 0;
        this.transition("closed");
      }
      return;
    }
    this.consecutiveFailures = 0;
  }

  private onFailure(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    if (this.state === "half-open") {
      this.trip();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.opts.failureThreshold) {
      this.trip();
    }
  }

  private trip() {
    this.openedAt = Date.now();
    this.transition("open");
  }

  /** Jalankan fn di bawah proteksi breaker. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.beforeCall();
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (e) {
      this.onFailure(e);
      throw e;
    }
  }

  /**
   * Jalankan fn; bila breaker terbuka ATAU fn gagal, kembalikan fallback
   * (bukan throw) — untuk jalur yang punya nilai default aman.
   */
  async runWithFallback<T>(fn: () => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
    try {
      return await this.run(fn);
    } catch {
      return await fallback();
    }
  }

  /** Reset manual (mis. setelah admin memperbaiki sesuatu). */
  reset() {
    this.consecutiveFailures = 0;
    this.halfOpenSuccesses = 0;
    this.lastError = null;
    this.transition("closed");
  }
}

// ---------------------------------------------------------------------------
// Registry — satu breaker per dependensi eksternal, dibagikan seluruh modul.
// ---------------------------------------------------------------------------

const registry = new Map<string, CircuitBreaker>();

export function circuitBreaker(name: string, opts?: Partial<BreakerOptions>): CircuitBreaker {
  let breaker = registry.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker(name, opts);
    registry.set(name, breaker);
  }
  return breaker;
}

/** Semua dependensi eksternal yang diproteksi — untuk panel observabilitas. */
export function circuitBreakerSnapshots() {
  return [...registry.values()].map((b) => b.snapshot());
}

"use client";

/**
 * Typed API client for the /api boundary.
 * All requests are same-origin relative paths (platform gateway requirement).
 */

export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; issues?: unknown[] } };

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly issues?: unknown[],
    /** Extra fields carried by the error envelope (e.g. block reason). */
    public readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("network", "Koneksi ke server gagal. Periksa jaringan Anda.", 0);
  }
  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError("parse", "Respons server tidak dapat dibaca.", res.status);
  }
  if (!res.ok || !envelope.ok) {
    const err = envelope.ok ? null : envelope.error;
    throw new ApiError(
      err?.code ?? "unknown",
      err?.message ?? "Terjadi kesalahan tak terduga.",
      res.status,
      err?.issues,
      // Whole envelope error object — carries extra fields like block reason.
      err ? (err as unknown as Record<string, unknown>) : undefined
    );
  }
  return envelope.data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

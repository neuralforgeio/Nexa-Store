# Nexa Store — Architecture

## Deployment topology (PRD §56 boundary)

```text
Browser (customer / admin / developer)
  │  hash-SPA at "/" (sandbox constraint A1) — public reads via /api/catalog
  ▼
Next.js App Router (Vercel serverless in production)
  │  /api/auth/*       login/logout/session (HMAC cookie)
  │  /api/management/* role-guarded catalog + settings mutations
  │  /api/developer/*  developer-only tooling
  ▼
CatalogRepository (interface — PRD §55)
  ├── LocalCatalogRepository   data/**/*.json + sha256 conflict + atomic writes + .history snapshots
  └── GitHubCatalogRepository  REST Contents read + Git Data API single-commit writes
        (owner/repo/branch from server env ONLY; path allowlist of 5 canonical files)
```

## Module ownership

| Module | Responsibility |
|---|---|
| `src/lib/catalog/types.ts` | domain types + canonical file keys |
| `src/lib/catalog/schema.ts` | Zod schemas + per-file validation (granular issues) |
| `src/lib/catalog/validation.ts` | cross-record integrity rules (PRD §36) |
| `src/lib/catalog/mutations.ts` | typed batch operations, diff summaries, commit messages |
| `src/lib/catalog/seed.ts` | PRD §14 verbatim seed (61 products) — parity-test guarded |
| `src/lib/catalog/repo/*` | repository boundary + local/github adapters |
| `src/lib/auth/*` | session HMAC, credentials, permission matrix, rate limit |
| `src/lib/whatsapp/*` | template engine (fail-closed placeholders) + wa.me URL |
| `src/app/api/*` | thin handlers: guard → validate → mutate → envelope |

Dependency direction: UI → queries → api-client → API routes → domain libs → repository. UI never touches adapter internals (PRD §54 migration path holds).

## Mutation contract (D4)

`POST /api/management/catalog` — `{ baseRevision, baseFileShas, operations[≤50] }` → apply → full validation → conflict check (revision + per-file SHA) → one commit (`store: …`). Errors: 400 validation, 401/403 authz, 409 conflict, 502 storage. Client state machine: IDLE → DIRTY → (preview) → SYNCING → SUCCESS | CONFLICT | ERROR (PRD §33/§34).

## Conflict model

- Local: revision token (`local-N` ledger) + sha256(file bytes) per canonical file.
- GitHub: branch head SHA + blob SHAs; re-checked immediately before ref update.
- Both: stale base → `409`, drafts preserved client-side, reload-and-retry UX.

## Session model

HMAC-SHA256 signed token `base64url(payload).sig` in HTTP-only `SameSite=Lax` cookie, 8h TTL, stateless (serverless-compatible). Login rate limit: sliding window 5 attempts / 10 min / IP+email (in-memory; per-instance on serverless — documented limitation). Bootstrap credentials from env only; classified development-bootstrap (PRD §8.3) with swap-in IdP path isolated in `src/lib/auth/`.

## Key decisions

See `.plans/decision_matrix.md` (D1–D6) and assumptions ledger (A1–A14). ADR-worthy: dual-adapter persistence, hash-SPA routing, custom session vs next-auth, batch mutation contract.

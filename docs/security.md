# Nexa Store — Security Notes

## Secret discipline (PRD §30, AC-08)

- Secrets live only in server env (`SESSION_SECRET`, `AUTH_*`, `GITHUB_*`); `.env` is gitignored; `.env.example` ships placeholders.
- Verified: client chunks under `.next/static/` contain **no** credential/token values (grep scan, evidence manifest).
- Route handlers never return env values; diagnostics expose presence booleans only.
- GitHub error bodies are never surfaced raw to end users — mapped to safe Indonesian messages with kind-classified error codes.

## STRIDE (PRD §30.2)

| Threat | Analysis | Mitigation |
|---|---|---|
| Spoofing | Login brute force / session forgery | timing-safe credential compare; HMAC-signed cookie (tamper→rejected, tested); rate limit 5/10min (429 verified) |
| Tampering | Catalog writes by unauthorized actors | server-side capability checks per mutation (ADMIN+/DEVELOPER-only surfaces); Zod at all boundaries; batch ops are typed discriminated unions |
| Repudiation | "Who changed the price?" | every write = commit with message + author email; local history snapshots; GitHub commit trail in prod |
| Information disclosure | Secret leakage / user enumeration | bundle scan clean; generic login errors (no account existence hints); rate limiter keys not exposed |
| Denial of service | Login hammering / GitHub rate storms | sliding-window limiter; GitHub adapter maps 403+ratelimit headers to `rate-limit` with no retry storms |
| Elevation of privilege | ADMIN invoking developer tooling | permission matrix enforced server-side (verified: ADMIN→`/api/developer/data` = 403); UI hiding is never the control |

## GitHub path safety (PRD §30.3)

- Only 5 canonical paths are writable; keys are enum-typed end-to-end (no client-supplied paths reach the API).
- Owner/repo/branch resolve from env only; `readFileAt` refs validated (`local-\d+` local; hex SHA github) — traversal attempts rejected (tested).
- Writes validate the ENTIRE proposed snapshot (schema + integrity) before commit; malformed data cannot land.

## Concurrency / lost updates (PRD §18.3)

Revision token + per-file SHA double-check; stale writers get 409, never a silent overwrite. GitHub path re-checks branch head immediately before ref update.

## Known accepted limitations (honest)

- In-memory rate limiter is per-instance on serverless (documented; PRD §8.3 "where feasible"). Upgrade path: shared store or edge middleware.
- Bootstrap auth is env-backed (A8) — not a production IdP. Swap point: `src/lib/auth/*` only.
- Sandbox repo history contains an uploaded Vercel token (A10/R1): working tree untracked + gitignored; **history must be scrubbed/token rotated before any push of this sandbox repo** (production delivery uses a clean tree export instead).

#!/usr/bin/env node
/**
 * NEXA STORE — load test lokal (v1.22.0).
 *
 * Tujuan: MEMBUKTIKAN proteksi anti-flood app-layer bekerja — bukan
 * menyerang produksi. Target default 127.0.0.1:3000 (dev server lokal).
 * JANGAN mengarahkan ini ke nexastoregame.vercel.app: flooding infrastruktur
 * bersama Vercel melanggar ToS mereka, dan attack satu-sumber bukan DDoS
 * sungguhan (lapisan edge Vercel sudah menelan attack volumetric).
 *
 * Fase:
 *  0. WARM        — kompilasi rute (Turbopack lazy-compile).
 *  1. PROBE       — path pemindai (/.env, /wp-admin…) → harus 403.
 *  2. TRACK BURST — 100× lacak invalid → route-limit 60/5m (400 → 429).
 *  3. ORDER SPAM  — 60× order invalid → route-limit 20/5m (400 → 429).
 *  4. PAYLOAD     — body 300 KB ke /api/orders → harus 413 (cap proxy).
 *  5. API FLOOD   — 800× /api/catalog → global api-limit 600/menit (429).
 *  6. PAGE FLOOD  — 1200× GET / → global page-limit 900/menit (429).
 *
 * Lulus bila: probe 403, payload 413, tiap fase flood muncul 429,
 * dan TIDAK ADA satu pun 5xx (server tetap sehat saat digencet).
 */

const BASE = process.env.LOADTEST_BASE || "http://127.0.0.1:3000";

/** Pool konkurensi sederhana. */
async function pool(total, concurrency, worker) {
  let next = 0;
  let done = 0;
  const results = [];
  async function runOne() {
    while (true) {
      const i = next++;
      if (i >= total) return;
      results[i] = await worker(i);
      done++;
      if (done % 200 === 0) process.stdout.write(`    … ${done}/${total}\n`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runOne));
  return results;
}

function summarize(results) {
  const counts = {};
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const p = (q) => times[Math.min(times.length - 1, Math.floor(times.length * q))] ?? 0;
  return {
    counts,
    p50: p(0.5),
    p95: p(0.95),
    maxMs: times[times.length - 1] ?? 0,
  };
}

async function timedFetch(url, init) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, init);
    await res.arrayBuffer().catch(() => {});
    return { status: res.status, ms: performance.now() - t0 };
  } catch (e) {
    return { status: `err:${e.cause?.code ?? e.name ?? "network"}`, ms: performance.now() - t0 };
  }
}

function verdictLine(label, s, expect) {
  const dist = Object.entries(s.counts)
    .sort()
    .map(([k, v]) => `${k}×${v}`)
    .join(" ");
  console.log(`  ${label.padEnd(14)} ${dist}  p50=${s.p50.toFixed(0)}ms p95=${s.p95.toFixed(0)}ms`);
  return expect(s);
}

const failures = [];
function check(name, cond, detail) {
  if (cond) console.log(`  ✔ ${name}`);
  else {
    console.log(`  ✘ ${name} — ${detail}`);
    failures.push(`${name}: ${detail}`);
  }
}

async function main() {
  console.log(`\n██ NEXA STORE LOAD TEST → ${BASE}\n`);

  // Fase 0 — warm
  console.log("Fase 0 · WARM (kompilasi rute)");
  await timedFetch(`${BASE}/`);
  await timedFetch(`${BASE}/api/catalog`);
  await new Promise((r) => setTimeout(r, 500));
  console.log("  selesai\n");

  // Fase 1 — probe pemindai
  console.log("Fase 1 · PROBE (harus 403 semua)");
  const probes = ["/.env", "/.git/config", "/wp-admin/setup-config.php", "/phpmyadmin/", "/.aws/credentials"];
  const probeRes = [];
  for (const p of probes) {
    const r = await timedFetch(`${BASE}${p}`);
    probeRes.push(r);
    console.log(`    ${p.padEnd(30)} → ${r.status}`);
  }
  check("probe diblokir 403", probeRes.every((r) => r.status === 403), "ada probe yang lolos");
  console.log("");

  // Fase 2 — track burst (route limit 60/5m)
  console.log("Fase 2 · TRACK BURST — 100× /api/orders/track (limit route 60/5m)");
  const trackRes = await pool(100, 20, () =>
    timedFetch(`${BASE}/api/orders/track?id=${encodeURIComponent("NEXA-000000-AAAA")}`)
  );
  const s2 = summarize(trackRes);
  verdictLine("hasil", s2, () => true);
  check("muncul 429 (route limit)", (s2.counts[429] ?? 0) > 0, JSON.stringify(s2.counts));
  check("tanpa 5xx", !Object.keys(s2.counts).some((k) => String(k).startsWith("5")), JSON.stringify(s2.counts));
  console.log("");

  // Fase 3 — order spam (route limit 20/5m)
  console.log("Fase 3 · ORDER SPAM — 60× POST /api/orders invalid (limit route 20/5m)");
  const orderRes = await pool(60, 15, () =>
    timedFetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "cart", summary: "spam", items: [], total: 0 }),
    })
  );
  const s3 = summarize(orderRes);
  verdictLine("hasil", s3, () => true);
  check("muncul 429 (route limit)", (s3.counts[429] ?? 0) > 0, JSON.stringify(s3.counts));
  check("tanpa 5xx", !Object.keys(s3.counts).some((k) => String(k).startsWith("5")), JSON.stringify(s3.counts));
  console.log("");

  // Fase 4 — payload cap (proxy 413)
  console.log("Fase 4 · PAYLOAD — body 300 KB ke /api/orders (cap proxy 256 KB)");
  const bigBody = JSON.stringify({ source: "cart", summary: "x".repeat(300 * 1024), items: [], total: 0 });
  const payRes = await timedFetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: bigBody,
  });
  console.log(`    status → ${payRes.status}`);
  check("payload ditolak 413", payRes.status === 413, `dapat ${payRes.status}`);
  console.log("");

  // Fase 5 — API flood (global api limit 600/menit)
  console.log("Fase 5 · API FLOOD — 800× GET /api/catalog (limit global api 600/mnt)");
  const apiRes = await pool(800, 40, () => timedFetch(`${BASE}/api/catalog`));
  const s5 = summarize(apiRes);
  verdictLine("hasil", s5, () => true);
  check("muncul 429 (global api)", (s5.counts[429] ?? 0) > 0, JSON.stringify(s5.counts));
  check("mayoritas tetap 200", (s5.counts[200] ?? 0) >= 400, JSON.stringify(s5.counts));
  check("tanpa 5xx", !Object.keys(s5.counts).some((k) => String(k).startsWith("5")), JSON.stringify(s5.counts));
  console.log("");

  // Fase 6 — page flood (global page limit 900/menit)
  console.log("Fase 6 · PAGE FLOOD — 1200× GET / (limit global page 900/mnt)");
  const pageRes = await pool(1200, 60, () => timedFetch(`${BASE}/`));
  const s6 = summarize(pageRes);
  verdictLine("hasil", s6, () => true);
  check("muncul 429 (global page)", (s6.counts[429] ?? 0) > 0, JSON.stringify(s6.counts));
  check("mayoritas tetap 200", (s6.counts[200] ?? 0) >= 500, JSON.stringify(s6.counts));
  check("tanpa 5xx", !Object.keys(s6.counts).some((k) => String(k).startsWith("5")), JSON.stringify(s6.counts));
  console.log("");

  // Verifikasi pasca-flood: server masih hidup sehat?
  console.log("PASCA-FLOOD · verifikasi server tetap sehat");
  await new Promise((r) => setTimeout(r, 1500));
  const health = await timedFetch(`${BASE}/api/catalog`);
  console.log(`    /api/catalog → ${health.status} (${health.ms.toFixed(0)}ms)`);
  check("server pulih merespons 200", health.status === 200, `dapat ${health.status}`);

  console.log("\n──────────────────────────────────────────────");
  if (failures.length === 0) {
    console.log("✔ SEMUA FASE LULUS — proteksi anti-flood bekerja.");
  } else {
    console.log(`✘ ${failures.length} kegagalan:`);
    for (const f of failures) console.log(`   - ${f}`);
    process.exitCode = 1;
  }
  console.log("");
}

main().catch((e) => {
  console.error("load-test fatal:", e);
  process.exit(1);
});

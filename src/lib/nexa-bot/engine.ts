import { Nlp } from "@nlpjs/basic";
import brain from "../../../nexa-brain.js";
import { resolveCatalogQuery, withinDomain } from "../../../nexa-resolve.js";
import { getRepository } from "@/lib/catalog/repo";
import type { Game, Product } from "@/lib/catalog/types";

/**
 * Nexa Bot engine (v1.14.0) — otak AI lokal untuk obrolan storefront.
 *
 * Pipeline: gerbang konteks → resolver entitas katalog (NER ala Indonesia:
 * alias game + nominal) → klasifikasi niat NLP (@nlpjs/basic, model dilatih
 * train.js dari data katalog). Jawaban harga dirender dari katalog LIVE
 * (fresh) dengan fallback ke jawaban terlatih saat katalog tidak terbaca.
 *
 * 100% lokal — tanpa API eksternal.
 */

export type BotReply = {
  intent: string;
  score: number;
  answer: string;
};

const MAX_ANSWER = 780; // chatFileSchema: text max 800 — beri ruang.

let nlpPromise: Promise<Nlp> | null = null;

function getNlp(): Promise<Nlp> {
  if (!nlpPromise) {
    nlpPromise = Promise.resolve().then(() => {
      const nlp = new Nlp({ languages: ["en"], threshold: 0.5, autoSave: false });
      nlp.import(JSON.stringify(brain.model));
      return nlp;
    });
  }
  return nlpPromise;
}

// ---------------------------------------------------------------------------
// Render jawaban dari katalog live
// ---------------------------------------------------------------------------

const idr = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

function labelOf(p: Product, game: Game): string {
  const tail = p.id.slice(game.id.length + 1);
  const words: string[] = [];
  const push = (s: string) =>
    s
      .toLowerCase()
      .replace(/[_/]+/g, " ")
      .split(/[^a-z0-9+]+/)
      .filter(Boolean)
      .forEach((w) => {
        if (!words.includes(w)) words.push(w);
      });
  push(tail);
  push(p.name ?? "");
  push(p.denomination ?? "");
  if (p.bonus) push(p.bonus);
  return words.join(" ");
}

function renderProduct(p: Product, game: Game): string {
  const label = labelOf(p, game).replace(/\b\w/g, (c) => c.toUpperCase());
  return `${label} ${game.name}: ${idr(p.priceIdr)} ⚡ Pesan di halaman ${game.name} — isi data akun, checkout via WhatsApp, langsung diproses.`;
}

function renderGameList(game: Game, products: Product[]): string {
  const items = products
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((p) => `${labelOf(p, game)} ${idr(p.priceIdr)}`);
  const head = `⚡ ${game.name} — harga per ${brain.trainedAtLabel}:\n`;
  const tail = `\nSemua nominal + order ada di halaman game-nya 🎮`;
  const budget = 740 - head.length - tail.length;
  let used = 0;
  const out: string[] = [];
  for (const it of items) {
    const add = (out.length ? " • " : "") + it;
    if (used + add.length > budget) {
      out.push("…");
      break;
    }
    out.push(it);
    used += add.length;
  }
  return head + out.join(" • ") + tail;
}

type LiveSnapshot = { games: Game[]; products: Product[] } | null;

async function readLiveCatalog(): Promise<LiveSnapshot> {
  try {
    const { repo } = getRepository(false);
    const { snapshot } = await repo.readSnapshot();
    return { games: snapshot.games, products: snapshot.products };
  } catch {
    return null;
  }
}

async function trainedAnswer(intent: string): Promise<string | null> {
  try {
    const nlp = await getNlp();
    const answers = await nlp.findAllAnswers("en", intent);
    return answers?.[0]?.answer ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Jawaban utama
// ---------------------------------------------------------------------------

export async function nexaBotAnswer(text: string): Promise<BotReply> {
  const clean = (text ?? "").trim().slice(0, 800);
  if (!clean) {
    return { intent: "None", score: 0, answer: brain.persona.fallback };
  }

  // 1. Gerbang konteks — di luar ranah NEXA STORE ditolak sopan.
  if (!withinDomain(clean, brain.lexicon)) {
    return { intent: "off.Context", score: 1, answer: brain.persona.offContext };
  }

  // 2. Resolver katalog deterministik (game + nominal).
  const hit = resolveCatalogQuery(clean, brain.lexicon);
  if (hit) {
    if (hit.type === "product") {
      const live = await readLiveCatalog();
      const product = live?.products.find((p) => p.id === hit.productId);
      const game = live?.games.find((g) => g.id === hit.gameId);
      if (product && game) {
        return { intent: `price.${product.id}`, score: 1, answer: renderProduct(product, game) };
      }
      const fallback = await trainedAnswer(`price.${hit.productId}`);
      if (fallback) return { intent: `price.${hit.productId}`, score: 1, answer: fallback };
      return { intent: `price.${hit.productId}`, score: 1, answer: brain.persona.fallback };
    }
    const live = await readLiveCatalog();
    const game = live?.games.find((g) => g.id === hit.gameId);
    const products = live?.products.filter((p) => p.gameId === hit.gameId && p.enabled) ?? [];
    if (game && products.length > 0) {
      return { intent: `game.${game.id}`, score: 1, answer: renderGameList(game, products) };
    }
    const fallback = await trainedAnswer(`game.${hit.gameId}`);
    if (fallback) return { intent: `game.${hit.gameId}`, score: 1, answer: fallback };
    return { intent: `game.${hit.gameId}`, score: 1, answer: brain.persona.fallback };
  }

  // 3. Klasifikasi NLP.
  const nlp = await getNlp();
  const r = await nlp.process("en", clean);
  if (!r || r.intent === "None" || !r.score || r.score < 0.5 || !r.answer) {
    return { intent: "None", score: r?.score ?? 0, answer: brain.persona.fallback };
  }
  return { intent: r.intent, score: r.score, answer: r.answer.slice(0, MAX_ANSWER) };
}

// --- util kecil untuk rute API: status mode AI dari data store ---

export async function readAiModeFromStore(readBotState: () => Promise<unknown>): Promise<boolean> {
  try {
    const raw = (await readBotState()) as { nexaBot?: { autoReply?: boolean } } | null;
    return raw?.nexaBot?.autoReply !== false; // default: AKTIF
  } catch {
    return true;
  }
}

export const botPersona = brain.persona;

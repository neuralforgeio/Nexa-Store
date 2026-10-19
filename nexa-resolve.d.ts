// Tipe untuk nexa-resolve.js — resolver entitas katalog Nexa Bot.
import type { BrainLexicon } from "./nexa-brain";

export type CatalogHit =
  | { type: "product"; productId: string; gameId: string; gameName: string }
  | { type: "game"; gameId: string; gameName: string };

/** Kandidat produk hasil resolusi penyebutan lintas game (v1.15.0). */
export interface ProductMention {
  id: string;
  gameId: string;
  game: string;
  label: string;
  price: number;
}

export function resolveCatalogQuery(text: string, lexicon: BrainLexicon): CatalogHit | null;
export function resolveProductMention(text: string, lexicon: BrainLexicon): ProductMention[];
export function withinDomain(text: string, lexicon: BrainLexicon): boolean;
export function normalize(text: string): string;
export function findGame(
  norm: string,
  lexicon: BrainLexicon
): { game: BrainLexicon["games"][number]; alias: string } | null;

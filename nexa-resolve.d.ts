// Tipe untuk nexa-resolve.js — resolver entitas katalog Nexa Bot.
import type { BrainLexicon } from "./nexa-brain";

export type CatalogHit =
  | { type: "product"; productId: string; gameId: string; gameName: string }
  | { type: "game"; gameId: string; gameName: string };

export function resolveCatalogQuery(text: string, lexicon: BrainLexicon): CatalogHit | null;
export function withinDomain(text: string, lexicon: BrainLexicon): boolean;
export function normalize(text: string): string;

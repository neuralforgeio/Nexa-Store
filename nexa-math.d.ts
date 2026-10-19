// Tipe untuk nexa-math.js — kalkulator Nexa Bot (v1.15.0).
import type { BrainLexicon, BrainProduct } from "./nexa-brain";
import type { ProductMention } from "./nexa-resolve";

export type MathToken =
  | { t: "num"; n: number }
  | { t: "op"; op: "+" | "-" | "*" | "/" }
  | { t: "phrase"; words: string[] }
  | { t: "phraseNum"; words: string[] };

export function detectMath(text: string): boolean;
export function tokenizeMath(text: string): MathToken[] | null;
export function parseNumberWord(word: string): number | null;
export function solveMath(
  text: string,
  resolvePhrase: (phrase: string, lexicon: BrainLexicon) => ProductMention[],
  lexicon: BrainLexicon
): string | null;

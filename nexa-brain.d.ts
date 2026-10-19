// Tipe untuk nexa-brain.js — artefak dihasilkan train.js (jangan edit manual).
export interface BrainGame {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  units: string[];
  productCount: number;
}

export interface BrainProduct {
  id: string;
  gameId: string;
  denom: string;
  denomFull: string;
  bonus: boolean;
  tokens: string[];
}

export interface BrainLexicon {
  domainTokens: string[];
  greetings: string[];
  games: BrainGame[];
  products: BrainProduct[];
}

export interface BrainPersona {
  name: string;
  store: string;
  creator: string;
  creatorRole: string;
  github: string;
  engine: string;
  fallback: string;
  offContext: string;
}

declare const brain: {
  version: string;
  trainedAt: string;
  trainedAtLabel: string;
  persona: BrainPersona;
  lexicon: BrainLexicon;
  model: unknown;
};

export default brain;

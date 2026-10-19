/**
 * Deklarasi tipe minimal @nlpjs/basic (v5) — paket hanya menyediakan CommonJS
 * tanpa .d.ts. Cukup untuk pemakaian Nexa Bot (train dilakukan train.js).
 */
declare module "@nlpjs/basic" {
  export interface NlpProcessResult {
    locale?: string;
    utterance?: string;
    intent: string;
    score: number;
    answer?: string;
    answers?: Array<{ answer: string }>;
  }

  export class Nlp {
    constructor(settings?: Record<string, unknown>);
    addDocument(locale: string, utterance: string, intent: string): void;
    addAnswer(locale: string, intent: string, answer: string): void;
    train(): Promise<unknown>;
    process(locale: string, utterance: string, settings?: unknown): Promise<NlpProcessResult>;
    findAllAnswers(locale: string, intent: string): Promise<Array<{ answer: string }>>;
    import(data: string | Record<string, unknown>): void;
    export(minified?: boolean): string;
  }
}

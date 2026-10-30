// Tipe untuk nexa-agent.js — lapisan AGENT transaksi Nexa Bot (v1.18.0).

/** Field wajib produk — dikirim ke klien untuk kartu aksi. */
export interface AgentRequiredField {
  key: string;
  label: string;
  required: boolean;
}

/** Skema field order game (subset OrderField dari katalog). */
export interface AgentOrderField {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface AddToCartAction {
  type: "add_to_cart";
  productId: string;
  gameId: string;
  label: string;
  gameName: string;
  price: number;
  requiredFields: AgentRequiredField[];
}

export interface FillDataAction {
  type: "fill_data";
  productId: string;
  gameId: string;
  fields: Record<string, string>;
  customerName?: string;
}

export type AgentActionDto = AddToCartAction | FillDataAction;

export interface ExtractedAccountData {
  fields: Record<string, string>;
  hits: { key: string; label: string; value: string }[];
  customerName?: string;
}

export const AGENT_TTL_MS: number;

/** Apakah pesan bermaksud MEMESAN (bukan bertanya)? */
export function detectPurchaseIntent(text: string): boolean;

/** Ekstrak nilai field skema order dari pesan bebas — null bila bukan data. */
export function extractAccountData(
  text: string,
  orderFields: AgentOrderField[]
): ExtractedAccountData | null;

/** Jawaban + aksi ketika produk dimasukkan ke keranjang. */
export function agentAddToCart(p: {
  product: { id: string };
  game: { id: string; slug?: string; name: string; orderFieldSchema?: AgentOrderField[] };
  label: string;
  price: number;
  userName?: string | null;
  withCartAction?: boolean;
  siteUrl?: string;
}): { answer: string; action: AddToCartAction | null };

/** Jawaban + aksi ketika data akun diekstrak & diisikan. */
export function agentFillData(p: {
  product: { id: string };
  game: { id: string; name: string; orderFieldSchema?: AgentOrderField[] };
  label: string;
  price: number;
  extracted: { fields: Record<string, string>; hits?: unknown };
  customerName?: string;
}): { answer: string; action: FillDataAction };

/** Opsi pilihan bernomor (v1.21.0) — balas "1"/"2" → lapisan pick
 *  mengeksekusi add_to_cart. options dipersist engine per percakapan. */
export function agentAskChoice(p: {
  gameName?: string | null;
  reason?: "budget" | "ambiguous" | "list";
  options: Array<{ label: string; price: number }>;
  userName?: string | null;
}): { answer: string; options: Array<{ label: string; price: number }> };

/** Markdown → teks polos (jalur Telegram). */
export function stripMarkdown(text: string): string;

/** Markdown ringan bot → HTML aman untuk Telegram (parse_mode HTML). */
export function markdownToHtml(text: string): string;

/**
 * nexa-math.js — kalkulator Nexa Bot (v1.15.0).
 *
 * Kecerdasan hitung-hitungan untuk pertanyaan semacam:
 *   • "1 tambah 1 berapa"              → 1 + 1 = 2
 *   • "member mingguan dikali 2"       → harga produk LIVE × 2
 *   • "harga ff 70 kali 3 jadi berapa" → Rp10.000 × 3 = Rp30.000
 *
 * Pendekatan: tokenizer aritmetika Indonesia (tambah/kurang/kali/bagi +
 * angka berimbuhan rb/ribu/jt/juta) → operand frasa diresolveskan jadi
 * produk katalog (lintas game) oleh resolver NER → evaluasi dengan urutan
 * operasi standar (kali/bagi dulu). Angka yang menempel frasa (mis. "ff 70")
 * dicoba dulu sebagai nominal produk, bukan operand. Bukan if/else per
 * kalimat — parser generik yang menerima bentuk bebas.
 *
 * Murni lokal — tanpa network, tanpa dependensi. Dipakai bersama oleh
 * api/chat.js dan src/lib/nexa-bot/engine.ts.
 */

"use strict";

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const OP_ADD = ["tambah", "ditambah", "tambahkan", "plus", "+"];
const OP_SUB = ["kurang", "dikurang", "dikurangi", "minus", "-"];
const OP_MUL = ["kali", "dikali", "dikalikan", "×", "*", "x"];
const OP_DIV = ["bagi", "dibagi", "÷", ":"];

/** Kata buangan agar frasa operand bersih sebelum resolusi produk. */
const NOISE = new Set([
  "berapa", "hasil", "hasilnya", "jadi", "jadinya", "kira", "hitung",
  "hitunglah", "hitungin", "kalau", "kalo", "dong", "ya", "gak", "nggak",
  "kayak", "kayaknya", "apa", "itu", "sih", "deh", "price", "harga", "total",
  "buat", "untuk", "orang", "sekali", "bisa", "tolong", "coba",
]);

/** Angka berimbuhan: "20rb" → 20000, "1,5jt" → 1500000, "3k" → 3000. */
function parseNumberWord(word) {
  const m = word.match(/^(\d+(?:[.,]\d+)?)(rb|ribu|k|jt|juta|m)?$/i);
  if (!m) return null;
  let n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const suf = (m[2] ?? "").toLowerCase();
  if (suf === "rb" || suf === "ribu" || suf === "k") n *= 1_000;
  else if (suf === "jt" || suf === "juta" || suf === "m") n *= 1_000_000;
  return n;
}

/**
 * Pecah pesan jadi token:
 *   {t:"num",n} | {t:"op",op} | {t:"phrase",words:[…]} | {t:"phraseNum",words:[…,angka]}
 * phraseNum = angka menempel frasa — kemungkinan nominal produk ("ff 70"),
 * diselesaikan di tahap solve (coba produk dulu, fallback operand biasa).
 *
 * Mengembalikan null bila bukan kalimat matematika (tanpa operator, operand
 * kurang, operator ganda, dsb.).
 */
function tokenizeMath(text) {
  const raw = String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(\d)\.(\d{3})(?=\D|$)/g, "$1$2") // 10.000 → 10000
    .trim();
  if (!raw || raw.length > 120) return null;

  const tokens = [];
  let words = [];
  let hasRealWord = false;

  const flushPhrase = (attachNumber) => {
    const clean = words.filter((w) => w && w.length > 0 && (NOISE.has(w) ? false : true));
    if (clean.length > 0) {
      tokens.push(attachNumber ? { t: "phraseNum", words: clean } : { t: "phrase", words: clean });
    }
    words = [];
    hasRealWord = false;
  };

  for (const part of raw.split(" ")) {
    let matchedOp = null;
    if (OP_ADD.includes(part)) matchedOp = "+";
    else if (OP_SUB.includes(part)) matchedOp = "-";
    else if (OP_MUL.includes(part)) matchedOp = "*";
    else if (OP_DIV.includes(part)) matchedOp = "/";

    if (matchedOp) {
      flushPhrase(false);
      tokens.push({ t: "op", op: matchedOp });
      continue;
    }

    // "2x" / "3×" gaya singkat: operand + operator kali.
    const mulShort = part.match(/^(\d+(?:[.,]\d+)?)(?:x|×)$/i);
    if (mulShort) {
      flushPhrase(false);
      tokens.push({ t: "num", n: Number(mulShort[1].replace(",", ".")) });
      tokens.push({ t: "op", op: "*" });
      continue;
    }

    const n = parseNumberWord(part);
    if (n !== null) {
      // Angka menempel frasa nyata → kandidat nominal produk ("ff 70").
      if (hasRealWord && Number.isInteger(n) && n > 0 && n <= 100000) {
        words.push(part);
        tokens.push({ t: "phraseNum", words: words.filter((w) => !NOISE.has(w)) });
        words = [];
        hasRealWord = false;
      } else {
        flushPhrase(false);
        tokens.push({ t: "num", n });
      }
      continue;
    }
    words.push(part);
    if (!NOISE.has(part)) hasRealWord = true;
  }
  flushPhrase(false);

  const ops = tokens.filter((tk) => tk.t === "op").length;
  const operands = tokens.filter((tk) => tk.t !== "op").length;
  if (ops < 1 || operands < 2) return null;
  if (ops > 3 || operands > 4) return null;

  // Ekspresi harus berselang operand-operator: tanpa op beruntun / di ujung.
  let prevWasOp = false;
  let first = true;
  for (const tk of tokens) {
    if (tk.t === "op") {
      if (first || prevWasOp) return null;
      prevWasOp = true;
    } else {
      prevWasOp = false;
    }
    first = false;
  }
  if (prevWasOp) return null;
  return tokens;
}

// ---------------------------------------------------------------------------
// Evaluator dengan urutan operasi (×÷ sebelum +−)
// ---------------------------------------------------------------------------

function evaluate(items) {
  const pass = [...items];
  for (let i = 1; i < pass.length; i += 2) {
    if (pass[i].op === "*" || pass[i].op === "/") {
      const a = pass[i - 1].v;
      const b = pass[i + 1].v;
      if (pass[i].op === "/" && b === 0) return null;
      pass.splice(i - 1, 3, { v: pass[i].op === "*" ? a * b : a / b });
      i -= 2;
    }
  }
  let out = pass[0].v;
  for (let i = 1; i < pass.length; i += 2) {
    const b = pass[i + 1].v;
    if (pass[i].op === "+") out += b;
    else if (pass[i].op === "-") out -= b;
    else return null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// API utama
// ---------------------------------------------------------------------------

/** Deteksi: apakah pesan ini kalimat hitungan yang bisa dijawab kalkulator? */
function detectMath(text) {
  return tokenizeMath(text) !== null;
}

/**
 * Selesaikan kalimat hitungan.
 *
 * @param {string} text pesan pengguna
 * @param {(phrase:string, lexicon:object) => Array<{id:string,gameId:string,game:string,label:string,price:number}>}
 *        resolvePhrase — resolusi frasa → kandidat produk (harga dari
 *        katalog; di engine dibaca LIVE). Kosong = frasa tak dikenal.
 * @param {object} lexicon leksikon katalog (brain.lexicon)
 * @returns {string|null} jawaban siap kirim, atau null bila tak terjawab
 */
function solveMath(text, resolvePhrase, lexicon) {
  const tokens = tokenizeMath(text);
  if (!tokens) return null;

  // Resolusi operand per posisi.
  const operands = []; // {type:"num",n} | {type:"prod",cands:[…]}
  for (const tk of tokens) {
    if (tk.t === "num") {
      operands.push({ type: "num", n: tk.n });
      continue;
    }
    if (tk.t === "op") continue;

    const full = tk.words.join(" ");
    if (tk.t === "phraseNum") {
      // Coba dulu: frasa + angka = produk ("ff 70").
      let cands = [];
      try {
        cands = resolvePhrase(full, lexicon) ?? [];
      } catch {
        cands = [];
      }
      if (cands.length > 0) {
        operands.push({ type: "prod", cands });
        continue;
      }
      // Fallback: frasa tanpa angka = produk, angka = operand biasa.
      const numWord = tk.words[tk.words.length - 1];
      const n = parseNumberWord(numWord);
      const baseWords = tk.words.slice(0, -1);
      let baseCands = [];
      if (n !== null && baseWords.length > 0) {
        try {
          baseCands = resolvePhrase(baseWords.join(" "), lexicon) ?? [];
        } catch {
          baseCands = [];
        }
      }
      if (n !== null && baseCands.length > 0) {
        operands.push({ type: "prod", cands: baseCands });
        operands.push({ type: "num", n });
        continue; // CATATAN: dua operand dari satu token — urutan operator bisa ikut geser.
      }
      return null; // "ff 70" tak terjawab → bukan matematika kami
    }
    // Frasa murni ("member mingguan").
    if (full.length > 60) return null;
    let cands = [];
    try {
      cands = resolvePhrase(full, lexicon) ?? [];
    } catch {
      cands = [];
    }
    if (cands.length === 0) return null;
    operands.push({ type: "prod", cands });
  }

  // Susun ekspresi: sisipkan operator dari token asli sesuai urutan operand.
  const items = [];
  const partList = []; // untuk deskripsi: {kind:"num"|"op"|"prod", …}
  let oi = 0;
  for (const tk of tokens) {
    if (tk.t === "op") {
      items.push({ op: tk.op });
      partList.push({ kind: "op", sym: tk.op });
      continue;
    }
    const op = operands[oi];
    if (tk.t === "phraseNum" && op.type === "num") {
      // fallback terbelah: operand num lalu prod (dua operand, satu token)
      items.push({ v: op.n });
      partList.push({ kind: "num", text: fmtNum(op.n) });
      const op2 = operands[oi + 1];
      items.push({ v: op2.cands[0].price });
      partList.push({ kind: "prod", text: op2.cands[0].label, price: op2.cands[0].price });
      oi += 2;
      continue;
    }
    if (op.type === "num") {
      items.push({ v: op.n });
      partList.push({ kind: "num", text: fmtNum(op.n) });
    } else {
      items.push({ v: op.cands[0].price });
      partList.push({ kind: "prod", text: op.cands[0].label, price: op.cands[0].price });
    }
    oi += 1;
  }

  const result = evaluate(items);
  if (result === null || !Number.isFinite(result) || Math.abs(result) > 1e12) return null;

  const opSym = { "+": "+", "-": "-", "*": "×", "/": "÷" };
  const idr = (n) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
  const hasProduct = partList.some((p) => p.kind === "prod");
  const exprPretty = partList
    .map((p) => (p.kind === "op" ? opSym[p.sym] : p.kind === "num" ? p.text : idr(p.price)))
    .join(" ");

  const lines = [];
  if (hasProduct) {
    lines.push(`🧮 ${exprPretty} = ${idr(result)}`);
    // Alternatif bila operand produk ambigu antar game (mis. "member mingguan"
    // ada di Free Fire & FF MAX) — sebut hingga 2 alternatif harganya.
    const seen = new Set([Math.round(result)]);
    for (let i = 0; i < operands.length; i++) {
      const op = operands[i];
      if (!op || op.type !== "prod") continue;
      for (const alt of op.cands.slice(1, 3)) {
        const values = operands.map((o, j) =>
          o.type === "num" ? o.n : j === i ? alt.price : o.cands[0].price
        );
        // Bangun ulang urutan nilai sesuai token (operand phraseNum terbelah skip).
        const altItems = [];
        let aj = 0;
        for (const tk of tokens) {
          if (tk.t === "op") {
            altItems.push({ op: tk.op });
          } else if (tk.t === "phraseNum" && operands[aj] && operands[aj].type === "num") {
            altItems.push({ v: values[aj] });
            altItems.push({ v: values[aj + 1] });
            aj += 2;
          } else {
            altItems.push({ v: values[aj] });
            aj += 1;
          }
        }
        const altResult = evaluate(altItems);
        if (altResult !== null && Number.isFinite(altResult)) {
          const rounded = Math.round(altResult);
          if (!seen.has(rounded)) {
            seen.add(rounded);
            lines.push(`Kalau yang kamu maksud ${alt.label} (${alt.game}): ${idr(altResult)}`);
          }
        }
      }
    }
    lines.push(`Pesan langsung di halaman game-nya ya ⚡`);
  } else {
    lines.push(`🧮 ${exprPretty} = ${fmtNum(result)}`);
    lines.push(`Mau hitung harga top up? Sebut produknya — mis. "ff 100 kali 3" ⚡`);
  }
  return lines.join("\n");
}

function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))).replace(".", ",");
}

module.exports = { detectMath, solveMath, tokenizeMath, parseNumberWord };

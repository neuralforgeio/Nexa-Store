/**
 * Bukti bolak-balik barcode (pre-push gate v1.16.0):
 * 1. Encoder Code128 jsbarcode (modul yang sama dipakai runtime) → pola bar.
 * 2. Raster pola ke piksel hitam-putih (3px/modul, margin 30, tinggi 110 —
 *    persis parameter PNG unduhan).
 * 3. Dekode dengan @zxing/library (mesin yang sama dipakai pemindai
 *    @zxing/browser) → teks HARUS kembali identik.
 * Juga menguji extractOrderId: URL resi → ID Order.
 */
const JsBarcode = require("jsbarcode");
const {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
  GlobalHistogramBinarizer,
} = require("@zxing/library");

const payloads = [
  "https://nexastoregame.vercel.app/track?id=NEXA-261019-X2B7",
  "https://nexastoregame.vercel.app/track?id=NEXA-261108-9QZ4",
  "http://127.0.0.1:3000/track?id=NEXA-261019-X2B7",
];

function encodeCode128(text) {
  const Code128 = JsBarcode.getModule("CODE128");
  const encoder = new Code128(text, { displayValue: false });
  if (!encoder.valid()) throw new Error(`payload tidak valid utk CODE128: ${text}`);
  const encoded = encoder.encode();
  // linearize sederhana (mirip linearizeEncodings): encode() CODE128 mengembalikan
  // array datar encoding { data: "1011..", text }.
  const list = Array.isArray(encoded) ? encoded : [encoded];
  return list.map((e) => e.data).join("");
}

function rasterize(binary, modulePx, height, margin) {
  const w = binary.length * modulePx + margin * 2;
  const h = height + margin * 2;
  const px = new Uint8ClampedArray(w * h).fill(255); // putih
  for (let i = 0; i < binary.length; i++) {
    if (binary[i] !== "1") continue;
    for (let y = margin; y < margin + height; y++) {
      for (let x = i * modulePx + margin; x < (i + 1) * modulePx + margin; x++) {
        px[y * w + x] = 0;
      }
    }
  }
  return { px, w, h };
}

function decode({ px, w, h }) {
  const source = new RGBLuminanceSource(px, w, h);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  for (const Binarizer of [HybridBinarizer, GlobalHistogramBinarizer]) {
    try {
      return reader.decode(new BinaryBitmap(new Binarizer(source))).getText();
    } catch {
      // coba binarizer berikutnya
    }
  }
  throw new Error("ZXing gagal mendekode");
}

let fail = 0;
for (const payload of payloads) {
  const bin = encodeCode128(payload);
  const img = rasterize(bin, 3, 110, 30);
  const back = decode(img);
  const ok = back === payload;
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${payload.length} karakter, ${bin.length} modul → "${back}"`
  );
}

// extractOrderId: URL resi → ID Order (logika pemindai).
process.chdir("/home/z/my-project");
const { extractOrderId } = require("/home/z/my-project/src/lib/barcode/index.ts");
const cases = [
  ["https://nexastoregame.vercel.app/track?id=NEXA-261019-X2B7", "NEXA-261019-X2B7"],
  ["NEXA-261019-X2B7", "NEXA-261019-X2B7"],
  ["nexa261019x2b7", "NEXA-261019-X2B7"],
  ["resi saya NEXA-261108-9QZ4 ya bang", "NEXA-261108-9QZ4"],
  ["https://example.com/t/NEXA-261019-X2B7", "NEXA-261019-X2B7"],
  ["halo selamat pagi", null],
  ["https://example.com/?id=BUKAN-NEXA", null],
];
for (const [input, expected] of cases) {
  const got = extractOrderId(input);
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} extractOrderId(${JSON.stringify(input)}) = ${JSON.stringify(got)}`);
}

if (fail > 0) {
  console.error(`\n${fail} kasus GAGAL`);
  process.exit(1);
}
console.log("\nSEMUA KASUS LOLOS — barcode Code128 terbukti bolak-balik.");

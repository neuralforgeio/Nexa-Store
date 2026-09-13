import { test, expect } from "bun:test";
import { formatIdr, parseIdrInput } from "@/lib/format/idr";
import { toWaDigits, displayPhone } from "@/lib/format/phone";
import { buildWhatsAppUrl } from "@/lib/whatsapp/url";

test("formatIdr formats integer rupiah with id-ID", () => {
  expect(formatIdr(56000)).toBe("Rp56.000");
  expect(formatIdr(1200000)).toBe("Rp1.200.000");
  expect(formatIdr(4000)).toBe("Rp4.000");
  expect(formatIdr(0)).toBe("Rp0");
});

test("formatIdr rejects floats (money invariant, PRD §13.3)", () => {
  expect(() => formatIdr(56000.5)).toThrow();
});

test("parseIdrInput accepts common Indonesian formats", () => {
  expect(parseIdrInput("56000")).toBe(56000);
  expect(parseIdrInput("56.000")).toBe(56000);
  expect(parseIdrInput("Rp56.000")).toBe(56000);
  expect(parseIdrInput("rp 1.200.000")).toBe(1200000);
});

test("parseIdrInput rejects garbage and negatives", () => {
  expect(parseIdrInput("")).toBeNull();
  expect(parseIdrInput("abc")).toBeNull();
  expect(parseIdrInput("-5000")).toBeNull();
});

test("toWaDigits normalizes the configured store number (A12)", () => {
  expect(toWaDigits("+62 888-6567-888")).toBe("628886567888");
  expect(toWaDigits("08886567888")).toBe("628886567888");
  expect(toWaDigits("628886567888")).toBe("628886567888");
});

test("toWaDigits rejects malformed numbers", () => {
  expect(toWaDigits("+62")).toBeNull();
  expect(toWaDigits("")).toBeNull();
  expect(toWaDigits("not a number")).toBeNull();
});

test("displayPhone keeps the configured display formatting", () => {
  expect(displayPhone(" +62 888-6567-888 ")).toBe("+62 888-6567-888");
});

test("buildWhatsAppUrl produces wa.me deep link with encoded text (PRD §12)", () => {
  const url = buildWhatsAppUrl("+62 888-6567-888", "Halo Nexa Store");
  expect(url).toBe("https://wa.me/628886567888?text=Halo%20Nexa%20Store");
});

test("buildWhatsAppUrl encodes line breaks and unicode safely", () => {
  const url = buildWhatsAppUrl("08886567888", "Baris 1\nBaris 2 — harga Rp56.000");
  expect(url.startsWith("https://wa.me/628886567888?text=")).toBe(true);
  expect(url).toContain("%0A");
  expect(url).not.toContain(" ");
});

test("buildWhatsAppUrl throws for invalid destination", () => {
  expect(() => buildWhatsAppUrl("", "x")).toThrow();
  expect(() => buildWhatsAppUrl("12", "x")).toThrow();
});

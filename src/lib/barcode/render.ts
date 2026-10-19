"use client";

import { orderBarcodePayload } from "./index";

/**
 * Render + unduh barcode Code 128 (jsbarcode, import dinamis).
 * Dipakai komponen client — tidak untuk server.
 */

export type BarcodeRenderOptions = {
  /** Lebar satu modul garis (px dalam koordinat SVG/canvas). */
  moduleWidth?: number;
  /** Tinggi bar (px dalam koordinat SVG/canvas). */
  height?: number;
};

/**
 * Render barcode ke elemen SVG yang sudah ada di DOM, lalu buat responsif:
 * jsbarcode menulis width/height absolut — kita pindahkan ke viewBox supaya
 * barcode bisa melebar/menyusut mengikuti kontainer (style width:100%).
 */
export async function renderOrderBarcodeSvg(
  svg: SVGSVGElement,
  orderId: string,
  opts: BarcodeRenderOptions = {}
): Promise<void> {
  const JsBarcode = (await import("jsbarcode")).default;
  JsBarcode(svg, orderBarcodePayload(orderId), {
    format: "CODE128",
    width: opts.moduleWidth ?? 2,
    height: opts.height ?? 100,
    displayValue: false,
    margin: 10,
    background: "#ffffff",
    lineColor: "#000000",
  });
  const w = parseFloat(svg.getAttribute("width") ?? "0");
  const h = parseFloat(svg.getAttribute("height") ?? "0");
  if (w > 0 && h > 0) {
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
}

/**
 * Unduh barcode resi sebagai PNG resolusi tinggi: modul 3px + nomor ID Order
 * tercetak di bawah garis (label manusia di bawah barcode asli). Cukup jernih
 * untuk dipindai Google Lens dari galeri, dicetak, atau difoto layar lain.
 */
export async function downloadOrderBarcodePng(orderId: string): Promise<void> {
  const JsBarcode = (await import("jsbarcode")).default;
  const bars = document.createElement("canvas");
  JsBarcode(bars, orderBarcodePayload(orderId), {
    format: "CODE128",
    width: 3,
    height: 110,
    displayValue: false,
    margin: 30,
    background: "#ffffff",
    lineColor: "#000000",
  });

  // Susun kanvas akhir: barcode + strip nomor ID di bawahnya.
  const labelStrip = 74;
  const out = document.createElement("canvas");
  out.width = bars.width;
  out.height = bars.height + labelStrip;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("canvas-2d-unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(bars, 0, 0);
  ctx.fillStyle = "#000000";
  ctx.font =
    "700 30px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(orderId, out.width / 2, bars.height + labelStrip / 2, out.width - 60);

  const url = out.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = `barcode-pesanan-${orderId}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

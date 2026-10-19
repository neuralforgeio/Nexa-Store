/** SVG barcode uji (dipakai E2E: unggah ke pemindai Galeri). */
const JsBarcode = require("jsbarcode");

const payload = "http://127.0.0.1:3000/track?id=NEXA-261019-X2B7";

// Fake DOM minimal untuk renderer SVG jsbarcode — cukup elemen dengan
// antarmuka yang dipakai renderer (setAttribute/appendChild/firstChild/…).
function makeNode(name) {
  return {
    tagName: name,
    nodeName: name,
    attrs: {},
    children: [],
    parent: null,
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    },
    getAttribute(k) {
      return k in this.attrs ? this.attrs[k] : null;
    },
    hasAttribute(k) {
      return k in this.attrs;
    },
    removeAttribute(k) {
      delete this.attrs[k];
    },
    appendChild(c) {
      c.parent = this;
      this.children.push(c);
      return c;
    },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c);
    },
    get firstChild() {
      return this.children[0] ?? null;
    },
  };
}

const svg = makeNode("svg");
global.document = {
  createElementNS: (_ns, name) => makeNode(name),
  createElement: (name) => makeNode(name),
};

JsBarcode(svg, payload, {
  format: "CODE128",
  width: 3,
  height: 110,
  displayValue: false,
  margin: 30,
  background: "#ffffff",
  lineColor: "#000000",
});

const w = svg.getAttribute("width");
const h = svg.getAttribute("height");

function serialize(node) {
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  const kids = node.children.map(serialize).join("");
  return `<${node.tagName} ${attrs}>${kids}</${node.tagName}>`;
}

// Tinggal 2 level (svg > g > rect) — cukup serialisasi manual.
const groups = svg.children
  .map((g) => {
    const gAttrs = Object.entries(g.attrs).map(([k, v]) => `${k}="${v}"`).join(" ");
    const rects = g.children
      .map((r) => {
        const rAttrs = Object.entries(r.attrs).map(([k, v]) => `${k}="${v}"`).join(" ");
        return `<rect ${rAttrs} />`;
      })
      .join("");
    return `<g ${gAttrs}>${rects}</g>`;
  })
  .join("");

const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${String(w).replace(/px$/,"")} ${String(h).replace(/px$/,"")}"><rect width="100%" height="100%" fill="#ffffff"/>${groups}</svg>`;
require("fs").writeFileSync("/tmp/nexa-barcode-test.svg", out);
console.log(`OK → /tmp/nexa-barcode-test.svg (${w}x${h}) payload=${payload}`);

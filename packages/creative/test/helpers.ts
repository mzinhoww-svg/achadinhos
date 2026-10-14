import { inflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import { productPlaceholder } from "../src/placeholder.ts";

/** PNG de produto de verdade (decodificável), gerado do placeholder — sem rede. */
export function productPng(hue = 340, label = "FONE", size = 800): Uint8Array {
  const dataUri = productPlaceholder(hue, label);
  // O rótulo do placeholder usa `font-family="sans-serif"` (fonte do SO): fixture dependia da plataforma e o
  // snapshot divergia no Linux do CI. A foto de teste não carrega texto; as fontes do criativo são embutidas.
  const svg = Buffer.from(dataUri.split(",")[1]!, "base64").toString("utf8").replace(/<text[\s\S]*?<\/text>/g, "");
  return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
}

/** Decodifica PNG 8 bits RGBA/RGB não entrelaçado (saída do Resvg). */
export function decodePng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const b = Buffer.from(png);
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  const colorType = b[25]!;
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bpp || b[24] !== 8) throw new Error("PNG não suportado no teste");
  const chunks: Buffer[] = [];
  for (let o = 8; o < b.length; ) {
    const len = b.readUInt32BE(o);
    if (b.toString("ascii", o + 4, o + 8) === "IDAT") chunks.push(b.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp]! : 0;
      const up = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      const p = a + up - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      line[x] = (line[x]! + pred) & 255;
    }
    for (let x = 0; x < width; x++) {
      const s = x * bpp, d = (y * width + x) * 4;
      out[d] = line[s]!; out[d + 1] = line[s + 1]!; out[d + 2] = line[s + 2]!; out[d + 3] = bpp === 4 ? line[s + 3]! : 255;
    }
    prev = line;
  }
  return { width, height, rgba: out };
}

/** Fração de pixels que diferem mais que `perChannel` em algum canal. */
export function diffRatio(a: Uint8Array, b: Uint8Array, perChannel = 12): number {
  const A = decodePng(a), B = decodePng(b);
  if (A.width !== B.width || A.height !== B.height) return 1;
  let bad = 0;
  for (let i = 0; i < A.rgba.length; i += 4) {
    if (
      Math.abs(A.rgba[i]! - B.rgba[i]!) > perChannel ||
      Math.abs(A.rgba[i + 1]! - B.rgba[i + 1]!) > perChannel ||
      Math.abs(A.rgba[i + 2]! - B.rgba[i + 2]!) > perChannel
    ) bad++;
  }
  return bad / (A.width * A.height);
}

export function bodyStream(chunks: Uint8Array[], opts: { stallAfter?: boolean } = {}): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(chunks[i++]!);
      else if (!opts.stallAfter) ctrl.close();
      else return new Promise(() => {}); // nunca termina
    },
  });
}

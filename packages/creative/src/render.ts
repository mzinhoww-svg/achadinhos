import { readFileSync } from "node:fs";
import { createElement } from "react";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { Creative, type CreativeProps } from "./Creative.tsx";
import { CREATIVE_SIZE, fontFamily } from "./tokens.ts";

const fontFile = (name: string) => readFileSync(new URL(`../fonts/${name}`, import.meta.url));

type Weight = 400 | 600 | 700 | 800;
let fonts: { name: string; data: Buffer; weight: Weight; style: "normal" }[] | undefined;
function loadFonts() {
  fonts ??= [
    { name: fontFamily.text, data: fontFile("figtree-latin-400-normal.woff"), weight: 400, style: "normal" },
    { name: fontFamily.text, data: fontFile("figtree-latin-600-normal.woff"), weight: 600, style: "normal" },
    { name: fontFamily.text, data: fontFile("figtree-latin-700-normal.woff"), weight: 700, style: "normal" },
    { name: fontFamily.display, data: fontFile("bricolage-grotesque-latin-700-normal.woff"), weight: 700, style: "normal" },
    { name: fontFamily.display, data: fontFile("bricolage-grotesque-latin-800-normal.woff"), weight: 800, style: "normal" },
  ];
  return fonts;
}

/** JSX -> SVG (Satori) -> PNG 1080x1080 (Resvg). Determinístico: fontes vêm do repo. */
export async function renderCreativeSvg(props: CreativeProps): Promise<string> {
  return satori(createElement(Creative, props), { width: CREATIVE_SIZE, height: CREATIVE_SIZE, fonts: loadFonts() });
}

export async function renderCreativePng(props: CreativeProps): Promise<Uint8Array> {
  const svg = await renderCreativeSvg(props);
  return new Resvg(svg, { fitTo: { mode: "width", value: CREATIVE_SIZE } }).render().asPng();
}

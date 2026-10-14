import { mkdirSync, writeFileSync } from "node:fs";
import { renderCreativePng } from "../src/render.ts";
import { productPlaceholder } from "../src/placeholder.ts";

const out = new URL("../out/", import.meta.url);
mkdirSync(out, { recursive: true });
const png = await renderCreativePng({
  title: "Fone de ouvido Bluetooth com cancelamento de ruído e estojo carregador",
  imageUrl: productPlaceholder(340, "FONE"),
  priceCurrent: 99.9,
  priceOld: 189.9,
  discountPct: 47,
  affiliateHandle: "@achadinhos.demo",
});
writeFileSync(new URL("sample.png", out), png);
console.log("ok", png.length, "bytes");

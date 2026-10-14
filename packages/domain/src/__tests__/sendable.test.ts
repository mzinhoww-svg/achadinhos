import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHOPEE_LINK_HOSTS,
  isAllowedImageUrl,
  isAllowedLink,
  sendableOfferField,
} from "../sendable";

const ok = {
  title: "Fone",
  priceCurrent: 50,
  priceOld: 80,
  discountPct: 37,
  productUrl: "https://shopee.com.br/p/1",
  imageUrl: "https://down-br.img.susercontent.com/a.jpg",
};
const opts = { linkHosts: DEFAULT_SHOPEE_LINK_HOSTS, imageHosts: ["susercontent.com"] };

describe("sendableOfferField (critério único seleção + executor)", () => {
  it("aceita oferta válida", () => {
    expect(sendableOfferField(ok, opts)).toBeUndefined();
  });
  it.each([
    ["title", { title: "x".repeat(501) }],
    ["title", { title: " " }],
    ["priceCurrent", { priceCurrent: 0 }],
    ["priceOld", { priceOld: 10 }],
    ["priceOld", { priceOld: Number.NaN }],
    ["discountPct", { discountPct: 150 }],
    ["discountPct", { discountPct: -5 }],
    ["productUrl", { productUrl: "http://shopee.com.br/p/1" }],
    ["productUrl", { productUrl: "https://evil.example/p/1" }],
    ["productUrl", { productUrl: "https://u:pw@shopee.com.br/p/1" }],
    ["imageUrl", { imageUrl: "https://evil.example/x.jpg" }],
    ["imageUrl", { imageUrl: "https://127.0.0.1/x.jpg" }],
    ["imageUrl", { imageUrl: "http://down-br.img.susercontent.com/a.jpg" }],
  ])("recusa %s", (field, patch) => {
    expect(sendableOfferField({ ...ok, ...patch }, opts)).toBe(field);
  });
});

describe("helpers", () => {
  it("isAllowedLink e isAllowedImageUrl", () => {
    expect(isAllowedLink("https://s.shopee.com.br/x", DEFAULT_SHOPEE_LINK_HOSTS)).toBe(true);
    expect(isAllowedLink("https://notshopee.com.br/x", DEFAULT_SHOPEE_LINK_HOSTS)).toBe(false);
    expect(isAllowedImageUrl("https://[::1]/a.jpg", ["susercontent.com"])).toBe(false);
  });
});

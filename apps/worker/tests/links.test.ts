import { describe, expect, it } from "vitest";

import { DEFAULT_SHOPEE_LINK_HOSTS, MAX_LINK_LENGTH, isAllowedLink, isHttpsUrl } from "../src/links.js";

const HOSTS = [...DEFAULT_SHOPEE_LINK_HOSTS];

describe("isAllowedLink", () => {
  it("exige https", () => {
    expect(isAllowedLink("https://shopee.com.br/oferta", HOSTS)).toBe(true);
    expect(isAllowedLink("http://shopee.com.br/oferta", HOSTS)).toBe(false);
    expect(isAllowedLink("ftp://shopee.com.br/oferta", HOSTS)).toBe(false);
    expect(isAllowedLink("shopee.com.br/oferta", HOSTS)).toBe(false);
  });

  it("recusa credenciais embutidas", () => {
    expect(isAllowedLink("https://user:pass@shopee.com.br/oferta", HOSTS)).toBe(false);
    expect(isAllowedLink("https://user@shopee.com.br/oferta", HOSTS)).toBe(false);
  });

  it("aceita host exato (qualquer host da allowlist)", () => {
    expect(isAllowedLink("https://shopee.com.br/oferta", HOSTS)).toBe(true);
    expect(isAllowedLink("https://shp.ee/abc123", HOSTS)).toBe(true);
    expect(isAllowedLink("https://shope.ee/abc123", HOSTS)).toBe(true);
    expect(isAllowedLink("https://s.shopee.com.br/abc123", HOSTS)).toBe(true);
  });

  it("aceita subdomínio de um host da allowlist", () => {
    expect(isAllowedLink("https://br.shopee.com.br/oferta", HOSTS)).toBe(true);
    expect(isAllowedLink("https://a.b.shopee.com.br/oferta", HOSTS)).toBe(true);
  });

  it("recusa host parecido (não é o host nem subdomínio dele)", () => {
    expect(isAllowedLink("https://notshopee.com.br/oferta", HOSTS)).toBe(false);
    expect(isAllowedLink("https://shopee.com.br.evil.com/oferta", HOSTS)).toBe(false);
    expect(isAllowedLink("https://evil-shopee.com.br/oferta", HOSTS)).toBe(false);
    expect(isAllowedLink("https://evil.com/shopee.com.br", HOSTS)).toBe(false);
  });

  it("recusa tamanho acima do limite, mas aceita exatamente no limite", () => {
    const base = "https://shopee.com.br/";
    const atLimit = base + "a".repeat(MAX_LINK_LENGTH - base.length);
    const overLimit = base + "a".repeat(MAX_LINK_LENGTH - base.length + 1);
    expect(atLimit.length).toBe(MAX_LINK_LENGTH);
    expect(overLimit.length).toBe(MAX_LINK_LENGTH + 1);
    expect(isAllowedLink(atLimit, HOSTS)).toBe(true);
    expect(isAllowedLink(overLimit, HOSTS)).toBe(false);
  });

  it("recusa entrada vazia, não-string ou com espaço em volta", () => {
    expect(isAllowedLink("", HOSTS)).toBe(false);
    expect(isAllowedLink(null, HOSTS)).toBe(false);
    expect(isAllowedLink(123, HOSTS)).toBe(false);
    expect(isAllowedLink(" https://shopee.com.br/oferta", HOSTS)).toBe(false);
    expect(isAllowedLink("https://shopee.com.br/oferta ", HOSTS)).toBe(false);
  });
});

describe("isHttpsUrl", () => {
  it("aceita https e recusa o resto", () => {
    expect(isHttpsUrl("https://exemplo.com/x")).toBe(true);
    expect(isHttpsUrl("http://exemplo.com/x")).toBe(false);
    expect(isHttpsUrl("não é url")).toBe(false);
    expect(isHttpsUrl(null)).toBe(false);
  });

  it("respeita o teto de tamanho", () => {
    const long = "https://exemplo.com/" + "a".repeat(2000);
    expect(long.length).toBeGreaterThan(2000);
    expect(isHttpsUrl(long)).toBe(false);
    expect(isHttpsUrl(long, long.length)).toBe(true);
  });
});

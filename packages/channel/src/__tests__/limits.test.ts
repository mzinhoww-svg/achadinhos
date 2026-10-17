import { describe, expect, it } from "vitest";
import { AFFILIATE_LINK_HOSTS, MAX_CREATIVE_PNG_BYTES, MAX_LINK_LENGTH, isAllowedLink } from "../limits";

describe("limits (§1 B3)", () => {
  it("constantes são a cópia exata de links.ts/build-deps.ts", () => {
    expect(AFFILIATE_LINK_HOSTS).toEqual(["shopee.com.br", "shp.ee", "shope.ee", "s.shopee.com.br"]);
    expect(MAX_LINK_LENGTH).toBe(300);
    expect(MAX_CREATIVE_PNG_BYTES).toBe(5_000_000);
  });

  it.each([
    ["https://shopee.com.br/produto", true],
    ["https://shope.ee/abc", true],
    ["https://s.shopee.com.br/abc", true],
    ["https://sub.shope.ee/abc", true],
    ["https://SHOPE.EE/abc", true],
    ["http://shope.ee/abc", false],
    ["ftp://shope.ee/abc", false],
    ["https://evil.example.com/abc", false],
    ["https://shopee.com.br.evil.com/abc", false],
    ["https://user:pw@shope.ee/abc", false],
    ["https://", false],
    ["not a url", false],
    ["https://shope.ee/abc ", false],
    [" https://shope.ee/abc", false],
  ])("isAllowedLink(%j) === %s", (url, expected) => {
    expect(isAllowedLink(url, AFFILIATE_LINK_HOSTS)).toBe(expected);
  });

  it("recusa acima de MAX_LINK_LENGTH", () => {
    const long = `https://shope.ee/${"a".repeat(MAX_LINK_LENGTH)}`;
    expect(long.length).toBeGreaterThan(MAX_LINK_LENGTH);
    expect(isAllowedLink(long, AFFILIATE_LINK_HOSTS)).toBe(false);
  });

  it.each([null, undefined, 7, {}, [], ""])("recusa não-string %j", (value) => {
    expect(isAllowedLink(value, AFFILIATE_LINK_HOSTS)).toBe(false);
  });
});

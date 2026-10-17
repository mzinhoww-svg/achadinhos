import { describe, expect, it } from "vitest";

import {
  AFFILIATE_LINK_HOSTS,
  MAX_LINK_LENGTH as CHANNEL_MAX_LINK_LENGTH,
  isAllowedLink as channelIsAllowedLink,
} from "@achadinhos/channel";
import { DEFAULT_SHOPEE_LINK_HOSTS, MAX_LINK_LENGTH, isAllowedLink } from "../src/links.js";

const HOSTS = [...DEFAULT_SHOPEE_LINK_HOSTS];
const CHANNEL_HOSTS = [...AFFILIATE_LINK_HOSTS];

const URLS: string[] = [
  "https://shopee.com.br/oferta",
  "https://shope.ee/abc123",
  "https://s.shopee.com.br/abc123",
  "https://br.shopee.com.br/oferta",
  "http://shopee.com.br/oferta",
  "https://evil.example.com/oferta",
  "https://shopee.com.br.evil.com/oferta",
  "https://user:pass@shopee.com.br/oferta",
  "https://shope.ee/abc123 ",
  "not a url",
  "",
  `https://shope.ee/${"a".repeat(MAX_LINK_LENGTH)}`,
];

describe("paridade com apps/worker/src/links.ts (§1 B3)", () => {
  it("AFFILIATE_LINK_HOSTS é igual a DEFAULT_SHOPEE_LINK_HOSTS", () => {
    expect(CHANNEL_HOSTS).toEqual(HOSTS);
  });

  it("MAX_LINK_LENGTH é o mesmo nos dois lados", () => {
    expect(CHANNEL_MAX_LINK_LENGTH).toBe(MAX_LINK_LENGTH);
  });

  it.each(URLS)("isAllowedLink devolve o mesmo para %j", (url) => {
    expect(channelIsAllowedLink(url, CHANNEL_HOSTS)).toBe(isAllowedLink(url, HOSTS));
  });

  it.each([null, undefined, 7, {}, []])("isAllowedLink devolve o mesmo para não-string %j", (value) => {
    expect(channelIsAllowedLink(value, CHANNEL_HOSTS)).toBe(isAllowedLink(value, HOSTS));
  });
});

import { describe, expect, it } from "vitest";

import { ShopeeClient } from "../client.js";

const KNOWN_APP_ID = "test-app-id";
const KNOWN_TIMESTAMP = 1700000000;
const KNOWN_PAYLOAD = '{"query":"{ productOfferV2 { nodes { itemId } } }"}';
const KNOWN_SECRET = "test-secret";
const KNOWN_SIGNATURE = "faa5565ca55ba5480b116301b4e82d4b156c720696143d844be31f0362bebd12";

describe("ShopeeClient signature", () => {
  it("calculates SHA256 over the exact payload string (known vector)", () => {
    expect(
      ShopeeClient.sign(KNOWN_APP_ID, KNOWN_TIMESTAMP, KNOWN_PAYLOAD, KNOWN_SECRET),
    ).toBe(KNOWN_SIGNATURE);
  });

  it("accepts a numeric timestamp and produces the same digest", () => {
    expect(
      ShopeeClient.sign(KNOWN_APP_ID, String(KNOWN_TIMESTAMP), KNOWN_PAYLOAD, KNOWN_SECRET),
    ).toBe(KNOWN_SIGNATURE);
  });

  it("changes when the payload changes", () => {
    const other = ShopeeClient.sign(
      KNOWN_APP_ID,
      KNOWN_TIMESTAMP,
      '{"query":"{ productOfferV2 { nodes { itemId productName } } }"}',
      KNOWN_SECRET,
    );
    expect(other).not.toBe(KNOWN_SIGNATURE);
  });
});

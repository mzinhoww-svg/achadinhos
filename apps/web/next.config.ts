import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@achadinhos/creative", "@achadinhos/domain", "@achadinhos/shopee", "@achadinhos/telegram"],
  devIndicators: false,
};

export default config;

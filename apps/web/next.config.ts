import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@achadinhos/creative", "@achadinhos/domain", "@achadinhos/telegram"],
  devIndicators: false,
};

export default config;

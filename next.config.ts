import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  typescript: { tsconfigPath: "tsconfig.web.json" },
};

export default nextConfig;

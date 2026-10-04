import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@savebite/web-shared"],
  output: "standalone",
  experimental: { cpus: 1 },
  // The dev-only route indicator sits on top of the bottom navigation's first
  // tab in the phone-width layout. Errors still open the dev overlay.
  devIndicators: false,
};

export default nextConfig;

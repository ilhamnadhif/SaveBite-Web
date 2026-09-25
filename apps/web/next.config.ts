import type { NextConfig } from "next";
const nextConfig: NextConfig = { transpilePackages: ["@savebite/web-shared"], output: "standalone", experimental: { cpus: 1 } };
export default nextConfig;

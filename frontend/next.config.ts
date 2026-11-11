import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF.js (inside unpdf) loads its own worker and wasm files, so keep it out of the bundle and load it from node_modules.
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;

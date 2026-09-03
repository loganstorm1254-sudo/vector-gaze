import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ssh2 ships native crypto helpers Turbopack can't chunk — keep it Node-external.
  serverExternalPackages: ["ssh2", "cpu-features"],
  turbopack: {},
};

export default nextConfig;

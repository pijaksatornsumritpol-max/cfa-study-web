import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @libsql/client ships native bindings; let Next require it at runtime
  // instead of bundling it (fixes Turbopack errors when server actions load it).
  serverExternalPackages: ["@libsql/client"],
};

export default nextConfig;

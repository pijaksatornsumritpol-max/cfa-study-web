import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Packages with native/large internals: require at runtime instead of
  // bundling (avoids Turbopack errors). @libsql/client (native bindings),
  // unpdf (bundles pdf.js), xlsx (large).
  serverExternalPackages: ["@libsql/client", "unpdf", "xlsx"],
};

export default nextConfig;

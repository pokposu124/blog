import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 네이티브 모듈이라 번들링되면 안 된다.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;

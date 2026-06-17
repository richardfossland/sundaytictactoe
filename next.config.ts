import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root: a stray parent lockfile (~/package-lock.json) would
  // otherwise be auto-selected and break output tracing / env resolution.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;

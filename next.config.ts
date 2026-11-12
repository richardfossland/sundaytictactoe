import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root: a stray parent lockfile (~/package-lock.json) would
  // otherwise be auto-selected and break output tracing / env resolution.
  turbopack: {
    root: path.join(__dirname),
  },
  // Load-bearing, see docs/DECISIONS.md ADR-001: `typescript` is the TS 6 compat
  // package (no `bin.tsc`), so Next must type-check via the in-process API.
  experimental: {
    useTypeScriptCli: false,
  },
};

export default nextConfig;

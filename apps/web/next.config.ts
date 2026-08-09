import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for the Cloud Run Docker image.
  output: "standalone",
  // Trace files from the monorepo root so the standalone bundle includes the
  // hoisted node_modules and the @ayooda/shared workspace package.
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;

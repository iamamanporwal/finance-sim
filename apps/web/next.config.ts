import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Internal packages are consumed as TypeScript source.
  transpilePackages: ["@fin/formula-engine", "@fin/model-schema", "@fin/simulation-engine"],
  reactStrictMode: true,
};

export default nextConfig;

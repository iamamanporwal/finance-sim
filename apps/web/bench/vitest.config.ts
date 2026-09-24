import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Performance measurements, kept out of the normal test run: `pnpm perf`. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  test: { include: ["bench/**/*.perf.ts"], root: fileURLToPath(new URL("..", import.meta.url)), testTimeout: 300_000 },
});

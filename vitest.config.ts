import path from "node:path";
import { defineConfig } from "vitest/config";

const isRulesTestRun =
  process.argv.some((arg) => arg.includes("firestore-rules")) ||
  Boolean(process.env.FIRESTORE_EMULATOR_HOST);

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: isRulesTestRun
      ? ["tests/firestore-rules.test.ts", "src/**/*.{test,spec}.{ts,tsx}"]
      : ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: isRulesTestRun
      ? ["node_modules", "dist", ".output", "tests/*.spec.ts"]
      : ["node_modules", "dist", ".output", "tests/**"],
  },
});

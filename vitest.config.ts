import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/src/**/*.test.ts",
      "apps/**/src/**/*.test.{ts,tsx}",
      "apps/**/test/**/*.test.ts",
      "scripts/**/*.test.{ts,mts,js,mjs}"
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"]
    }
  }
});

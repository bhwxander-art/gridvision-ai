import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Stub Next.js server-only guard so repository modules can be imported
    // in the Vitest Node environment without the full Next.js runtime.
    server: {
      deps: {
        inline: ["server-only"],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // Stub "server-only" — it only throws if imported outside Next.js;
      // in Vitest we want the repository logic, not the guard.
      "server-only": path.resolve(__dirname, "tests/__mocks__/server-only.ts"),
    },
  },
});

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const shared = (file: string) => fileURLToPath(new URL(`../../packages/web-shared/src/${file}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  esbuild: { jsx: "automatic" },
  resolve: {
    // Regex keys so `@savebite/web-shared` does not also capture the
    // `@savebite/web-shared/server` subpath (string aliases are prefix matches).
    alias: [
      { find: /^@savebite\/web-shared$/, replacement: shared("index.ts") },
      { find: /^@savebite\/web-shared\/server$/, replacement: shared("server.ts") },
      { find: /^@savebite\/web-shared\/client$/, replacement: shared("client.ts") },
      { find: /^@savebite\/web-shared\/snap$/, replacement: shared("snap.ts") },
    ],
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: ["app/**/route.ts", "middleware.ts"],
    },
  },
});

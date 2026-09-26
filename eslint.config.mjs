// ESLint 9 flat config for the SaveBite monorepo.
//
// Intentionally narrow: correctness rules that catch real production bugs
// (React hooks, Next.js client/server boundaries, floating promises, unsafe
// escapes) plus type-aware rules. Style is not linted -- the codebase has a
// deliberate, consistent hand-rolled style that we do not want to churn.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/*.tsbuildinfo",
      "apps/web/next-env.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---- App + shared package source -------------------------------------
  {
    files: ["apps/web/**/*.{ts,tsx}", "packages/web-shared/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,

      // React 19 compiler-safe correctness rules.
      ...reactHooks.configs.recommended.rules,

      // Types
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      // Correctness
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
      "no-implicit-coercion": ["error", { allow: ["!!"] }],
      "no-return-await": "error",
      "no-throw-literal": "error",

      // Next.js
      "@next/next/no-html-link-for-pages": ["error", "apps/web/app"],

      // Merchant imagery comes from public Supabase Storage buckets whose URLs
      // are only known at runtime, so next/image would need a remote pattern and
      // would proxy every photo through this 1-CPU VPS. We keep <img> and instead
      // set explicit lazy loading / decoding on each site (see <BagImage>).
      "@next/next/no-img-element": "off",
    },
  },

  // ---- Route handlers & middleware (server runtime) --------------------
  {
    files: [
      "apps/web/app/**/route.ts",
      "apps/web/middleware.ts",
      "packages/web-shared/src/server.ts",
    ],
    languageOptions: { globals: { ...globals.node } },
  },

  // ---- Test files -------------------------------------------------------
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // ---- Scripts / config -------------------------------------------------
  {
    files: ["scripts/**/*.mjs", "*.config.{ts,js,mjs}", "**/*.config.{ts,js,mjs}"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "no-console": "off" },
  },
);

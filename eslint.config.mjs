import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const WEBVIEW_JS_FILES = ["packages/extension/media/**/*.js"];
const NODE_JS_FILES = ["**/*.{js,cjs,mjs}"];

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/out/**", "**/.wrangler/**", "**/*.d.ts"],
  },

  {
    files: WEBVIEW_JS_FILES,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        acquireVsCodeApi: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },

  {
    files: NODE_JS_FILES,
    ignores: WEBVIEW_JS_FILES,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },

  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          minimumDescriptionLength: 10,
          "ts-check": false,
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  prettier,
];

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  {
    ignores: ["dist/", "node_modules/", "docs/"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "complexity": ["warn", { max: 15 }],
      "max-depth": ["warn", { max: 4 }],
      "max-lines-per-function": ["warn", { max: 120, skipBlankLines: true, skipComments: true, IIFEs: true }],
      "sonarjs/cognitive-complexity": ["warn", 20],
      "sonarjs/no-duplicate-string": ["warn", { threshold: 3 }],
      "sonarjs/no-identical-functions": "warn",
      "sonarjs/no-collapsible-if": "warn",
      "sonarjs/no-redundant-jump": "warn",
      "sonarjs/prefer-single-boolean-return": "warn",
      "sonarjs/no-small-switch": "warn",
      "sonarjs/no-nested-template-literals": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "sonarjs/no-duplicate-string": "off",
      "max-lines-per-function": "off",
      "sonarjs/publicly-writable-directories": "off",
      "sonarjs/no-os-command-from-path": "off",
    },
  },
);
